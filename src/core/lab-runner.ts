import {newQuickJSWASMModuleFromVariant,type QuickJSWASMModule,type QuickJSContext,type QuickJSHandle} from 'quickjs-emscripten-core';
import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync';
let defaultModule:Promise<QuickJSWASMModule>|undefined;
import type {JsonValue,LabTask} from '../data/practice-units';
import {sameJson,type LabRun} from './lab';
/** No host objects/functions except bounded console text enter the guest context. */
export async function runLabCode(code:string,task:LabTask,budget=1000,module?:QuickJSWASMModule):Promise<LabRun> {
 const run:LabRun={code,taskId:task.id,checks:[],logs:[],error:''};
 if(code.length>20000){run.error='代码最多 20000 字符';return run;}
 const qjs=module||await (defaultModule ||=newQuickJSWASMModuleFromVariant(RELEASE_SYNC)),runtime=qjs.newRuntime();runtime.setMemoryLimit(32*1024*1024);runtime.setMaxStackSize(512*1024);
 let deadline=Date.now()+Math.min(1000,Math.max(10,budget));runtime.setInterruptHandler(()=>Date.now()>deadline);
 const vm=runtime.newContext();
 try {
  const array=vm.getProp(vm.global,'Array'),isArray=vm.getProp(array,'isArray');
  let readNodes=0,readText=0;
  const consumeText=(size:number)=>{if(size>4000||readText+size>4000)throw new Error('返回文本或日志超过输出预算');readText+=size;};
  const read=(handle:QuickJSHandle,depth=0):JsonValue=>{
   if(++readNodes>512)throw new Error('返回结构超过输出预算');
   if(depth>6)throw new Error('返回结构太深');
   const type=vm.typeof(handle);
   if(type==='string'){const s=vm.getString(handle);consumeText(s.length);return s;}
   if(type==='number'){const n=vm.getNumber(handle);if(!Number.isFinite(n))throw new Error('返回值需要有限数值');return n;}
   if(type==='boolean')return vm.eq(handle,vm.true);
   if(type!=='object')throw new Error(`返回值为 ${type}；请检查 return`);
   if(vm.eq(handle,vm.null))return null;
   const arrResult=vm.unwrapResult(vm.callFunction(isArray,array,handle));const arr=vm.eq(arrResult,vm.true);arrResult.dispose();
   let arrayLength=0;
   if(arr){const length=vm.getProp(handle,'length');try{arrayLength=vm.getNumber(length);}finally{length.dispose();}if(!Number.isSafeInteger(arrayLength)||arrayLength<0||arrayLength>64)throw new Error('返回数组最多 64 项');}
   const names=vm.unwrapResult(vm.getOwnPropertyNames(handle,{strings:true,numbersAsStrings:true}));
   try {
    const keys=names.map(h=>vm.getString(h)).filter(k=>!arr||k!=='length');if(keys.length>64)throw new Error('返回值最多 64 个成员');
    if(arr&&(keys.length!==arrayLength||keys.some(key=>! /^(0|[1-9]\d*)$/.test(key)||Number(key)>=arrayLength)))throw new Error('返回数组需要连续项目，不能包含空项或额外属性');
    for(const key of keys)consumeText(key.length);
    const result:JsonValue[]|Record<string,JsonValue>=arr?[]:Object.create(null);
    for(const key of keys){const prop=vm.getProp(handle,key);try{(result as any)[key]=read(prop,depth+1);}finally{prop.dispose();}}
    return result;
   }finally{names.dispose();}
  };
  const consoleHandle=vm.newObject();let logSize=0;
  const log=vm.newFunction('log',(...args)=>{if(logSize>=4000||run.logs.length>=50)return;let text='';try{text=args.map(h=>{try{const val=read(h);return typeof val==='string'?val:JSON.stringify(val);}catch{return `[${vm.typeof(h)}]`;}}).join(' ');}catch{text='日志不可显示';}text=text.slice(0,4000-logSize);run.logs.push(text);logSize+=text.length;});
  vm.setProp(consoleHandle,'log',log);vm.setProp(vm.global,'console',consoleHandle);log.dispose();consoleHandle.dispose();
  try {
   const loaded=vm.evalCode(code,'learner.js');if(loaded.error){run.error=errorText(vm,loaded.error);loaded.error.dispose();return run;}loaded.value.dispose();
   if(!task.entry)return run;
   const fn=vm.getProp(vm.global,task.entry);
   try {
    if(vm.typeof(fn)!=='function'){run.error=`请定义函数 ${task.entry}`;return run;}
    for(const c of task.cases){
     deadline=Date.now()+Math.min(1000,Math.max(10,budget));
     const args=c.args.map(a=>toGuest(vm,a));
     try{const result=vm.callFunction(fn,vm.undefined,...args);if(result.error){const error=errorText(vm,result.error);result.error.dispose();run.checks.push({input:structuredClone(c.args),label:c.label,expected:c.expected,passed:false,error});if(/interrupt|out of memory/i.test(error)){run.error='运行超过时间或内存预算';break;}}else{try{const actual=read(result.value);run.checks.push({input:structuredClone(c.args),label:c.label,expected:c.expected,actual,passed:sameJson(actual,c.expected)});}catch(e){run.checks.push({input:structuredClone(c.args),label:c.label,expected:c.expected,passed:false,error:String(e)});}finally{result.value.dispose();}}}finally{args.forEach(a=>a.dispose());}
    }
   }finally{fn.dispose();}
  }finally{isArray.dispose();array.dispose();}
 }catch(e){run.error=e instanceof Error?e.message:String(e);}finally{vm.dispose();runtime.dispose();}
 return run;
}
function toGuest(vm:QuickJSContext,value:JsonValue):QuickJSHandle {
 if(value===null)return vm.null.dup();if(typeof value==='string')return vm.newString(value);if(typeof value==='number')return vm.newNumber(value);if(typeof value==='boolean')return (value?vm.true:vm.false).dup();
 const result=Array.isArray(value)?vm.newArray():vm.newObject();for(const [key,val] of Object.entries(value)){const h=toGuest(vm,val);vm.setProp(result,key,h);h.dispose();}return result;
}
function errorText(vm:QuickJSContext,handle:QuickJSHandle){try{const name=vm.getProp(handle,'name'),message=vm.getProp(handle,'message');try{return `${vm.getString(name)}: ${vm.getString(message)}`.slice(0,1000);}finally{name.dispose();message.dispose();}}catch{return '运行出错';}}
