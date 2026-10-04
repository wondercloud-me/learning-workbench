import {practiceUnit,type JsonValue} from '../data/practice-units';
import type {HelpLevel} from './learning';
export type LabMode='practice'|'transfer';
export interface LabCheck {input?:JsonValue[];label:string;passed:boolean;expected:JsonValue;actual?:JsonValue;error?:string}
export interface LabRun {code:string;taskId:string;checks:LabCheck[];logs:string[];error:string}
export interface LabSession {unitId:string;mode:LabMode;learnedAt:string;code:string;hintsSeen:number;helpLevel:HelpLevel}
export interface LabAttempt extends LabRun {id:string;unitId:string;mode:LabMode;helpLevel:HelpLevel;explanation:string;passed:boolean;createdAt:string}
export interface LabState {sessions:Record<string,LabSession>;attempts:LabAttempt[]}
export const emptyLab=():LabState=>({sessions:{},attempts:[]});
const day=(s:string)=>new Date(s).toLocaleDateString('sv-SE');
export function labTask(id:string,mode:LabMode){const unit=practiceUnit(id);return mode==='practice'?unit.task:unit.transfer;}
function session(lab:LabState,id:string,mode:LabMode){const s=lab.sessions[`${id}:${mode}`];if(!s)throw new Error('先学习并确认，再开始任务');return s;}
export function beginLab(lab:LabState,id:string,mode:LabMode,now:string):LabState {
 const task=labTask(id,mode),key=`${id}:${mode}`;
 if(mode==='transfer'){const prior=lab.attempts.filter(a=>a.unitId===id&&a.mode==='practice'&&a.passed);if(!prior.length)throw new Error('先完成当前任务并解释');if(!prior.some(a=>day(a.createdAt)<day(now)))throw new Error('换到另一天再做变式');}
 if(lab.sessions[key])return lab;
 return {...lab,sessions:{...lab.sessions,[key]:{unitId:id,mode,learnedAt:now,code:task.starter,hintsSeen:0,helpLevel:'independent'}}};
}
export function setLabCode(lab:LabState,id:string,mode:LabMode,code:string):LabState {const s=session(lab,id,mode);if(code.length>20000)throw new Error('代码最多 20000 字符');return {...lab,sessions:{...lab.sessions,[`${id}:${mode}`]:{...s,code}}};}
export function revealLabHint(lab:LabState,id:string,mode:LabMode):LabState {const s=session(lab,id,mode);return {...lab,sessions:{...lab.sessions,[`${id}:${mode}`]:{...s,hintsSeen:Math.min(s.hintsSeen+1,labTask(id,mode).hints.length),helpLevel:s.helpLevel==='explained'?'explained':'hinted'}}};}
export function labPassed(run:LabRun,id:string,mode:LabMode){const task=labTask(id,mode);return run.taskId===task.id&&!run.error&&run.checks.length===task.cases.length&&run.checks.every((c,i)=>c.label===task.cases[i].label&&c.passed===true&&!c.error&&sameJson(c.expected,task.cases[i].expected)&&sameJson(c.actual,task.cases[i].expected));}
export function saveLabAttempt(lab:LabState,id:string,mode:LabMode,run:LabRun,explanation:string,now:string):LabState {
 const s=session(lab,id,mode);if(run.taskId!==labTask(id,mode).id)throw new Error('运行结果属于其他任务');if(run.code!==s.code)throw new Error('代码已变化，请重新运行');if(explanation.trim().length<8)throw new Error('请用自己的话解释至少 8 个字，再保存产出');
 const attempt:LabAttempt={...structuredClone(run),id:crypto.randomUUID(),unitId:id,mode,helpLevel:s.helpLevel|| (s.hintsSeen?'hinted':'independent'),explanation:explanation.trim(),passed:labPassed(run,id,mode),createdAt:now};
 return {...lab,attempts:[...lab.attempts,attempt]};
}
export function labSummary(lab:LabState,id:string,now:string){const passed=lab.attempts.filter(a=>a.unitId===id&&a.passed);const base=passed.filter(a=>a.mode==='practice');const independent=passed.filter(a=>a.helpLevel==='independent'&&a.explanation.trim().length>=8);return {passed:passed.length,attempts:lab.attempts.filter(a=>a.unitId===id).length,transferDue:base.some(a=>day(a.createdAt)<day(now))&&!passed.some(a=>a.mode==='transfer'),independentRepeated:independent.some(a=>a.mode==='practice'&&independent.some(b=>b.mode==='transfer'&&day(b.createdAt)>day(a.createdAt)))};}
const validDate=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&Number.isFinite(Date.parse(value));
function validChecks(checks:unknown[]):boolean {
 let nodes=0,text=0;
 const json=(value:unknown,depth=0):boolean=>{
  if(++nodes>512||depth>6)return false;
  if(value===null||typeof value==='boolean')return true;
  if(typeof value==='number')return Number.isFinite(value);
  if(typeof value==='string'){text+=value.length;return value.length<=4000&&text<=12000;}
  if(!value||typeof value!=='object')return false;
  const keys=Object.keys(value);if(keys.length>64)return false;
  if(Array.isArray(value)&&(value.length>64||keys.length!==value.length||keys.some(k=>!/^(0|[1-9]\d*)$/.test(k)||Number(k)>=value.length)))return false;
  return keys.every(key=>{text+=key.length;return key.length<=200&&text<=12000&&json((value as Record<string,unknown>)[key],depth+1);});
 };
 return checks.every(value=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;const c=value as Record<string,unknown>;
  return typeof c.label==='string'&&c.label.length<=200&&typeof c.passed==='boolean'&&json(c.expected)
   &&(c.actual===undefined||json(c.actual))&&(c.error===undefined||typeof c.error==='string'&&c.error.length<=1000)
   &&(c.input===undefined||Array.isArray(c.input)&&json(c.input));
 });
}
export function normalizeLab(value:unknown):LabState {
 const result=emptyLab();if(!value||typeof value!=='object')return result;const data=value as any;
 for(const s of Object.values(data.sessions||{}) as any[]){try{if(!s||!['practice','transfer'].includes(s.mode)||!validDate(s.learnedAt)||typeof s.code!=='string'||s.code.length>20000)continue;const task=labTask(s.unitId,s.mode);result.sessions[`${s.unitId}:${s.mode}`]={unitId:s.unitId,mode:s.mode,learnedAt:s.learnedAt,code:s.code,hintsSeen:Math.min(task.hints.length,Math.max(0,Number.isInteger(s.hintsSeen)?s.hintsSeen:0)),helpLevel:s.helpLevel==='explained'?'explained':s.helpLevel==='hinted'||s.hintsSeen>0?'hinted':'independent'};}catch{}}
 for(const a of Array.isArray(data.attempts)?data.attempts:[]){try{if(!a||!['practice','transfer'].includes(a.mode)||!validDate(a.createdAt)||typeof a.id!=='string'||typeof a.code!=='string'||a.code.length>20000||typeof a.explanation!=='string'||a.explanation.trim().length<8||!['independent','hinted','explained'].includes(a.helpLevel)||!Array.isArray(a.checks)||!Array.isArray(a.logs)||typeof a.error!=='string'||a.error.length>1000)continue;const task=labTask(a.unitId,a.mode);if(a.taskId!==task.id||a.checks.length>task.cases.length||!validChecks(a.checks)||a.logs.length>50||a.logs.some((s:unknown)=>typeof s!=='string'||s.length>4000)||a.logs.join('').length>4000)continue;result.attempts.push({id:a.id,unitId:a.unitId,mode:a.mode,code:a.code,taskId:a.taskId,checks:a.checks.map((c:any)=>({label:c.label,passed:c.passed,expected:c.expected,...(c.input?{input:c.input}:{}),...(c.actual!==undefined?{actual:c.actual}:{}),...(c.error?{error:c.error}:{})})),logs:a.logs,error:a.error,helpLevel:a.helpLevel,explanation:a.explanation,createdAt:a.createdAt,passed:labPassed(a,a.unitId,a.mode)});}catch{}}
 return result;
}

export function declareLabHelp(lab:LabState,id:string,mode:LabMode,level:HelpLevel):LabState {
 const s=session(lab,id,mode),rank={independent:0,hinted:1,explained:2};if(!(level in rank))throw new Error('提示程度不正确');
 return {...lab,sessions:{...lab.sessions,[`${id}:${mode}`]:{...s,helpLevel:rank[level]>rank[s.helpLevel||'independent']?level:s.helpLevel||'independent'}}};
}
export function sameJson(a:unknown,b:unknown):boolean {
 if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();return ak.length===bk.length&&ak.every((k,i)=>k===bk[i]&&sameJson((a as any)[k],(b as any)[k]));
}
