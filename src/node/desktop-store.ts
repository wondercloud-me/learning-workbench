import {mkdir,rename,rm,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {createBackup,type VersionedBackup} from '../core/backup';
import {validateBrowserDocument,type BrowserDocument} from '../core/browser-state';
import type {DesktopRuntime,DesktopSnapshot,DesktopWrite} from '../core/desktop-document';
import type {AppState} from '../core/state';
import {loadDesktopDocument} from './state-storage';

export interface DesktopStore {
 readonly recoveryFile?:string;
 snapshot():DesktopSnapshot;
 load():Promise<DesktopSnapshot>;
 save(input:DesktopWrite):Promise<DesktopSnapshot>;
 runtime(generation:number,change:(current:AppState)=>Pick<AppState,'usageRecords'|'contexts'>):Promise<DesktopRuntime>;
 flush():Promise<void>;
 export(generation:number,writer:(backup:VersionedBackup)=>Promise<boolean>):Promise<boolean>;
 restore(generation:number,reader:()=>Promise<BrowserDocument|null>):Promise<DesktopSnapshot|null>;
}
type Options={file:string;legacyFile:string;appVersion:string;write?:(file:string,text:string)=>Promise<void>};
type FailureKind='save'|'runtime';
const copy=<T>(value:T):T=>structuredClone(value);

/** Unique temporary files prevent independent file users from sharing a staging path. */
async function atomicWrite(file:string,text:string):Promise<void> {
 await mkdir(path.dirname(file),{recursive:true});
 const temp=`${file}.tmp-${randomUUID()}`;
 try {await writeFile(temp,text,{flag:'wx',mode:0o600});await rename(temp,file);}
 finally {await rm(temp,{force:true}).catch(()=>{});}
}

export async function openDesktopStore({file,legacyFile,appVersion,write=atomicWrite}:Options):Promise<DesktopStore> {
 const loaded=await loadDesktopDocument({file,legacyFile});
 let committed:DesktopSnapshot={document:loaded.document,generation:0,revision:0,mutationRevision:0};
 let tail:Promise<void>=Promise.resolve();
 let locked=false;
 const failures=new Map<FailureKind,unknown>();
 let pendingRuntime:{generation:number;fields:Pick<AppState,'usageRecords'|'contexts'>}|undefined;
 function enqueue<T>(operation:()=>Promise<T>):Promise<T> {
  const pending=tail.then(operation);tail=pending.then(()=>{},()=>{});return pending;
 }
 function checkGeneration(generation:number) {
  if(!Number.isSafeInteger(generation)||generation!==committed.generation)throw Error('文档代次已过期，请读取当前学习记录。');
 }
 function admit(generation:number) {checkGeneration(generation);if(locked)throw Error('正在导出或恢复学习记录，暂不能修改文档。');}
 function checkMutation(revision:number) {
  if(!Number.isSafeInteger(revision)||revision<=committed.mutationRevision)throw Error('保存版本已过期，不能覆盖更新后的学习记录。');
 }
 async function commit(document:BrowserDocument,generation:number,mutationRevision:number,kind:FailureKind|'restore'):Promise<DesktopSnapshot> {
  try {
   const next=validateBrowserDocument(document);
   if(kind==='runtime')pendingRuntime={generation,fields:copy({usageRecords:next.state.usageRecords,contexts:next.state.contexts})};
   await write(file,JSON.stringify(createBackup(next,appVersion,new Date().toISOString()),null,2));
   committed={document:next,generation,revision:committed.revision+1,mutationRevision};
   if(kind==='restore'){failures.clear();pendingRuntime=undefined;}
   else {failures.delete(kind);if(kind==='runtime')pendingRuntime=undefined;}
   return copy(committed);
  } catch(error){
   // A failed import leaves the current confirmed document untouched, not pending.
   if(kind!=='restore')failures.set(kind,error);
   throw error;
  }
 }
 function flush():Promise<void> {
  return enqueue(async()=>{if(failures.size)throw failures.values().next().value;});
 }
 // Locks apply to new admission only: admitted writes must drain before the barrier.
 function acquire(generation:number) {admit(generation);locked=true;}
 return {
  recoveryFile:loaded.recoveryFile,
  snapshot:()=>copy(committed),
  async load(){await flush();return copy(committed);},
  async save(input) {
   admit(input.generation);checkMutation(input.mutationRevision);
   const incoming=validateBrowserDocument(copy(input.document));
   const generation=input.generation;const mutationRevision=input.mutationRevision;
   return enqueue(async()=>{
    checkGeneration(generation);checkMutation(mutationRevision);
    const latest=committed.document.state;
    return commit({...incoming,state:{...incoming.state,usageRecords:latest.usageRecords,contexts:latest.contexts}},generation,mutationRevision,'save');
   });
  },
  async runtime(generation,change) {
   admit(generation);
   return enqueue(async()=>{
    checkGeneration(generation);
    let updated:Pick<AppState,'usageRecords'|'contexts'>;
    const latest=copy(committed.document.state);
    // A later producer retries valid failed runtime fields with current learner state.
    if(pendingRuntime?.generation===generation)Object.assign(latest,copy(pendingRuntime.fields));
    try {updated=change(latest);}
    catch(error){failures.set('runtime',error);throw error;}
    const current=committed.document;
    const next=await commit({...current,state:{...current.state,usageRecords:updated.usageRecords,contexts:updated.contexts}},generation,committed.mutationRevision,'runtime');
    return {generation:next.generation,revision:next.revision,usageRecords:next.document.state.usageRecords,contexts:next.document.state.contexts};
   });
  },
  flush,
  async export(generation,writer) {
   acquire(generation);
   try {await flush();checkGeneration(generation);return await writer(createBackup(copy(committed.document),appVersion,new Date().toISOString()));}
   finally {locked=false;}
  },
  async restore(generation,reader) {
   acquire(generation);
   try {
    await flush();checkGeneration(generation);
    const document=await reader();if(document===null)return null;
    const incoming=validateBrowserDocument(copy(document));
    return await enqueue(async()=>{checkGeneration(generation);return commit(incoming,generation+1,0,'restore');});
   } finally {locked=false;}
  },
 };
}
