import {afterEach, expect, it, vi} from 'vitest';
import {IDBFactory, IDBObjectStore} from 'fake-indexeddb';
import {openBrowserRepository, type BrowserRepository} from '../src/browser/repository';
import {createBrowserController, type BrowserController} from '../src/browser/controller';
import {beginStudy, beginVerification, confirmPlan, createColumn, markTaught, recordAnswer} from '../src/core/learning';
import {createSideChat} from '../src/core/sidechat';
import {appendReviewedVoiceDraft, issueVoiceDraftRequest, previewVoiceDraft, retireVoiceDraftRequest} from '../src/browser/voice/draft';
import type {VoiceDraftMode, VoiceDraftPort, VoiceDraftTarget} from '../src/browser/voice/types';

const controllers:BrowserController[]=[];const repos:BrowserRepository[]=[];
afterEach(()=>{vi.restoreAllMocks();controllers.splice(0).forEach(c=>c.close());repos.splice(0).forEach(r=>r.close());});
const now='2026-10-05T10:00:00.000Z';
async function setup(options:{mode?:VoiceDraftMode;phase?:'study'|'verify'|'teachback';sideId?:string;key?:string;text?:string}={}) {
 const factory=new IDBFactory();const r=await openBrowserRepository(factory,()=>now);repos.push(r);const c=await createBrowserController(r);controllers.push(c);
 let column=beginStudy(confirmPlan(createColumn('编程','理解函数',now,'column-a'),{target:'理解函数',steps:[
  {id:'step-1',title:'函数',outcome:'读懂参数',priority:1},{id:'step-2',title:'返回值',outcome:'读懂结果',priority:2},
 ]},now));
 if(options.phase==='verify'||options.phase==='teachback')column=beginVerification(markTaught(column));
 if(options.phase==='teachback')column=recordAnswer(column,'fixture answer','independent',now);
 const key=options.key??'question:column-a';const text=options.text??'原文';
 await c.change(d=>({...d,state:{...d.state,onboarding:{...d.state.onboarding,introSeen:true},columns:[column],activeColumnId:column.id,
  sideChats:options.sideId?[createSideChat({id:options.sideId,columnId:column.id,parentMessageId:'source',selectedText:'函数',sourceMessage:'函数可以接收参数',columnGoal:column.goal,now})]:[],
 },drafts:{...d.drafts,messages:{[key]:text}}}));
 const target:VoiceDraftTarget={page:'learn',learningView:'teaching',columnId:'column-a',sideId:options.sideId??null,mode:options.mode??'question',key,
  phase:column.phase,stepId:'step-1',documentGeneration:c.documentGeneration(),scopeVersion:0};
 const ui={target:target as VoiceDraftTarget|null,visible:true,composing:false};
 const port:VoiceDraftPort={target:()=>ui.target,current:()=>ui.visible,composing:()=>ui.composing};
 return {c,r,target,ui,port,factory};
}
const setDraft=(key:string,text:string)=>(d:ReturnType<BrowserController['pendingDocument']>)=>({...d,drafts:{...d.drafts,messages:{...d.drafts.messages,[key]:text}}});

it('refuses registration by a caller-supplied bare request number',async()=>{
 const {c,target,port}=await setup();
 expect(()=>Reflect.apply(previewVoiceDraft,undefined,[0,target,'函数',c,port])).toThrow();
});
it('issues frozen monotonic handles and permanently rejects retired, copied and foreign handles',async()=>{
 const {c,target,port}=await setup();const first=issueVoiceDraftRequest(c,target);
 expect(first.requestId).toBe(0);expect(Object.isFrozen(first)).toBe(true);
 const old=previewVoiceDraft(first,'旧文字',c,port);retireVoiceDraftRequest(first);retireVoiceDraftRequest(first);
 const second=issueVoiceDraftRequest(c,target);expect(second.requestId).toBe(1);
 for(const forged of [first,{...second},Object.freeze({requestId:second.requestId})])expect(()=>previewVoiceDraft(forged as typeof second,'函数',c,port)).toThrow();
 const other=await setup();const independent=issueVoiceDraftRequest(other.c,other.target);expect(independent.requestId).toBe(0);
 expect(()=>previewVoiceDraft(second,'函数',other.c,other.port)).toThrow();expect(()=>previewVoiceDraft(independent,'函数',c,port)).toThrow();
 const stale=appendReviewedVoiceDraft(old,c,port);expect(stale.applied).toBe(false);await expect(stale.saving).rejects.toMatchObject({code:'invalid'});
 const current=previewVoiceDraft(second,'函数',c,port);retireVoiceDraftRequest(first);
 const result=appendReviewedVoiceDraft(current,c,port);expect(result.applied).toBe(true);await result.saving;
 expect(c.pendingDocument().drafts.messages[target.key]).toBe('原文\n函数');
});
it('replacing requests leaves only the newest handle usable, with no ID reset after retirement',async()=>{
 const {c,target,port}=await setup();const handles:ReturnType<typeof issueVoiceDraftRequest>[]=[];
 for(let i=0;i<12;i++){
  const handle=issueVoiceDraftRequest(c,target);handles.push(handle);expect(handle.requestId).toBe(i);
  for(const old of handles.slice(0,-1))expect(()=>previewVoiceDraft(old,'旧文字',c,port)).toThrow();
 }
 const latest=handles.at(-1)!;expect(previewVoiceDraft(latest,'函数',c,port).requestId).toBe(11);
 retireVoiceDraftRequest(latest);expect(()=>previewVoiceDraft(latest,'函数',c,port)).toThrow();
 const remounted=issueVoiceDraftRequest(c,target);expect(remounted.requestId).toBe(12);
 expect(previewVoiceDraft(remounted,'函数',c,port).transcript).toBe('函数');
});
it.each(['preview','append'] as const)('rejects the old %s when a target-port callback synchronously issues its replacement',async(stage)=>{
 const {c,target,port}=await setup();const request=issueVoiceDraftRequest(c,target);const old=previewVoiceDraft(request,'旧文字',c,port);
 let current:ReturnType<typeof previewVoiceDraft>|undefined;
 const replacingPort:VoiceDraftPort={...port,current:()=>{
  const next=issueVoiceDraftRequest(c,target);current=previewVoiceDraft(next,'函数',c,port);return true;
 }};
 if(stage==='preview')expect(()=>previewVoiceDraft(request,'旧文字',c,replacingPort)).toThrow();
 else{const stale=appendReviewedVoiceDraft(old,c,replacingPort);expect(stale.applied).toBe(false);await expect(stale.saving).rejects.toMatchObject({code:'invalid'});}
 expect(c.pendingDocument().drafts.messages[target.key]).toBe('原文');
 const result=appendReviewedVoiceDraft(current!,c,port);expect(result.applied).toBe(true);await result.saving;
 expect(c.pendingDocument().drafts.messages[target.key]).toBe('原文\n函数');
});

it.each([
 ['', '函数', '函数'], ['原文', '函数', '原文\n函数'], ['原文\n', '函数', '原文\n函数'], ['  ', '函数', '  \n函数'],
])('adds reviewed transcription to raw draft %j without changing learning state',async(text,transcript,want)=>{
 const {c,r,target,port}=await setup({text});const request=issueVoiceDraftRequest(c,target);const before=c.pendingDocument();const revision=c.snapshot().revision;
 const preview=previewVoiceDraft(request,transcript,c,port);
 expect(preview.baseText).toBe(text);expect(c.snapshot().revision).toBe(revision);expect(c.isBusy()).toBe(false);
 const result=appendReviewedVoiceDraft(preview,c,port);expect(result.applied).toBe(true);
 expect(c.pendingDocument().drafts.messages['question:column-a']).toBe(want);await result.saving;
 expect((await r.load()).document).toEqual({...before,drafts:{...before.drafts,messages:{'question:column-a':want}}});expect(c.isBusy()).toBe(false);
});
it.each([
 ['question','study',undefined,'question:column-a'], ['material','study',undefined,'material:column-a'], ['ai','study',undefined,'ai:column-a'],
 ['learner','verify',undefined,'answer:column-a'], ['learner','teachback',undefined,'teachback:column-a'], ['learner','study','side-1','question:side:side-1'],
] as const)('uses the existing %s/%s teaching draft key',async(mode,phase,sideId,key)=>{
 const {c,target,port}=await setup({mode,phase,sideId,key});const request=issueVoiceDraftRequest(c,target);const state=c.pendingDocument().state;
 const result=appendReviewedVoiceDraft(previewVoiceDraft(request,'函数',c,port),c,port);await result.saving;
 expect(result.applied).toBe(true);expect(c.pendingDocument().drafts.messages).toEqual({[key]:'原文\n函数'});expect(c.pendingDocument().state).toEqual(state);
});
it.each([
 {page:'records'}, {learningView:'lab'}, {columnId:'column-b'}, {sideId:'side-2'}, {mode:'ai'}, {key:'material:column-a'},
 {phase:'verify'}, {stepId:'step-2'}, {documentGeneration:1}, {scopeVersion:1},
])('rejects a retained handler after target dimension %j changes',async(change)=>{
 const {c,target,port,ui}=await setup();const request=issueVoiceDraftRequest(c,target);const preview=previewVoiceDraft(request,'函数',c,port);
 ui.target={...target,...change} as VoiceDraftTarget;
 const result=appendReviewedVoiceDraft(preview,c,port);expect(result.applied).toBe(false);await expect(result.saving).rejects.toMatchObject({code:'invalid'});
 expect(c.pendingDocument().drafts.messages).toEqual({'question:column-a':'原文'});expect(c.isBusy()).toBe(false);
});
it('requires a visible current target and refuses composition before appending',async()=>{
 const {c,target,port,ui}=await setup();const request=issueVoiceDraftRequest(c,target);const preview=previewVoiceDraft(request,'函数',c,port);
 ui.visible=false;expect(()=>previewVoiceDraft(request,'函数',c,port)).toThrow();
 const hidden=appendReviewedVoiceDraft(preview,c,port);expect(hidden.applied).toBe(false);await expect(hidden.saving).rejects.toMatchObject({code:'invalid'});
 ui.visible=true;ui.composing=true;const composing=appendReviewedVoiceDraft(preview,c,port);expect(composing.applied).toBe(false);await expect(composing.saving).rejects.toMatchObject({code:'invalid'});
 ui.composing=false;ui.target=null;const absent=appendReviewedVoiceDraft(preview,c,port);await expect(absent.saving).rejects.toMatchObject({code:'invalid'});
 expect(c.pendingDocument().drafts.messages['question:column-a']).toBe('原文');
});
it.each(['column','active-column','phase','step','side'] as const)('checks the latest document when %s changes without a UI update',async(kind)=>{
 const side=kind==='side';const {c,target,port}=await setup(side?{sideId:'side-1',key:'question:side:side-1'}:{});const request=issueVoiceDraftRequest(c,target);
 const preview=previewVoiceDraft(request,'函数',c,port);
 await c.change(d=>({...d,state:{...d.state,
  ...(kind==='column'?{columns:[],activeColumnId:null}:{}),...(kind==='active-column'?{activeColumnId:null}:{}),...(kind==='side'?{sideChats:[]}:{}),
  ...(['phase','step'].includes(kind)?{columns:d.state.columns.map(col=>kind==='phase'?beginVerification(markTaught(col)):{...col,currentStepIndex:1})}:{}),
 }}));
 const before=c.pendingDocument();const result=appendReviewedVoiceDraft(preview,c,port);expect(result.applied).toBe(false);await expect(result.saving).rejects.toMatchObject({code:'invalid'});
 expect(c.pendingDocument()).toEqual(before);
});
it('refuses wrong keys, learner phases, blank transcription and invalid request IDs',async()=>{
 const {c,target,port,ui}=await setup();const request=issueVoiceDraftRequest(c,target);
 expect(previewVoiceDraft(request,'函数',c,port).transcript).toBe('函数');
 for(const transcript of ['', ' \n', 'x'.repeat(20001)])expect(()=>previewVoiceDraft(request,transcript,c,port)).toThrow();
 for(const requestId of [-1,NaN,Infinity,1.5])expect(()=>Reflect.apply(previewVoiceDraft,undefined,[requestId,'函数',c,port])).toThrow();
 for(const change of [{key:'help:column-a'},{mode:'learner',key:'answer:column-a'}] as const){const changed:VoiceDraftTarget={...target,...change};ui.target=changed;expect(()=>previewVoiceDraft(issueVoiceDraftRequest(c,changed),'函数',c,port)).toThrow();}
 expect(c.pendingDocument().drafts.messages).toEqual({'question:column-a':'原文'});
});
it('allows refreshed review of typed text but rejects both changed and reverted revisions',async()=>{
 const {c,target,port}=await setup();const request=issueVoiceDraftRequest(c,target);const preview=previewVoiceDraft(request,'函数',c,port);
 await c.change(setDraft('question:column-a','编辑后'));await c.change(setDraft('question:column-a','原文'));
 const stale=appendReviewedVoiceDraft(preview,c,port);expect(stale.applied).toBe(false);await expect(stale.saving).rejects.toMatchObject({code:'invalid'});
 await c.change(setDraft('question:column-a','最后输入'));
 const refreshed=previewVoiceDraft(request,'函数',c,port);expect(refreshed.baseText).toBe('最后输入');
 const result=appendReviewedVoiceDraft(refreshed,c,port);await result.saving;expect(c.pendingDocument().drafts.messages['question:column-a']).toBe('最后输入\n函数');
});
it('rechecks revision inside the mutator after synchronous lease subscribers type',async()=>{
 const {c,target,port}=await setup();const request=issueVoiceDraftRequest(c,target);const preview=previewVoiceDraft(request,'函数',c,port);let typing:Promise<unknown>|undefined;
 const stop=c.subscribe(()=>{if(c.isBusy()&&!typing){typing=Promise.resolve();typing=c.change(setDraft('question:column-a','同期输入'));}});
 const result=appendReviewedVoiceDraft(preview,c,port);stop();expect(result.applied).toBe(false);await expect(result.saving).rejects.toMatchObject({code:'invalid'});await typing;
 expect(c.pendingDocument().drafts.messages['question:column-a']).toBe('同期输入');
 const retry=appendReviewedVoiceDraft(previewVoiceDraft(request,'函数',c,port),c,port);await retry.saving;expect(c.pendingDocument().drafts.messages['question:column-a']).toBe('同期输入\n函数');
});
it('rejects old document previews after update or replacement even when text is unchanged',async()=>{
 const {c,target,port}=await setup();const request=issueVoiceDraftRequest(c,target);const preview=previewVoiceDraft(request,'函数',c,port);const release=c.acquireUpdateLock();
 const locked=appendReviewedVoiceDraft(preview,c,port);expect(locked.applied).toBe(false);await expect(locked.saving).rejects.toMatchObject({code:'unavailable'});release();
 const stale=appendReviewedVoiceDraft(preview,c,port);await expect(stale.saving).rejects.toMatchObject({code:'invalid'});expect(stale.applied).toBe(false);
 const {c:restored,target:old,port:oldPort}=await setup();const replacementPreview=previewVoiceDraft(issueVoiceDraftRequest(restored,old),'函数',restored,oldPort);
 await restored.replace(restored.pendingDocument());const replacement=appendReviewedVoiceDraft(replacementPreview,restored,oldPort);await expect(replacement.saving).rejects.toMatchObject({code:'invalid'});
 expect(restored.pendingDocument().drafts.messages['question:column-a']).toBe('原文');
});
it('rejects a retained preview after a real remote revision conflict without changing pending drafts or state',async()=>{
 const {c,target,port,factory}=await setup();const request=issueVoiceDraftRequest(c,target);const preview=previewVoiceDraft(request,'函数',c,port);
 const lease=c.acquireVoiceOperation();const other=await openBrowserRepository(factory,()=>now);repos.push(other);
 const remote=await other.load();await other.commit(setDraft('question:column-a','远程输入')(remote.document),remote.revision);
 expect(c.storageStatus()).toBe('conflict');lease.release();expect(c.isBusy()).toBe(false);
 expect(c.documentGeneration()).toBe(target.documentGeneration);expect(c.messageDraftRevision(target.key)).toBe(preview.baseRevision);
 const before=c.pendingDocument();const result=appendReviewedVoiceDraft(preview,c,port);
 expect(result.applied).toBe(false);await expect(result.saving).rejects.toMatchObject({code:'revision-conflict'});
 expect(c.pendingDocument()).toEqual(before);expect(c.pendingDocument().drafts.messages).toEqual({'question:column-a':'原文'});
 expect(c.pendingDocument().state).toEqual(before.state);expect((await other.load()).document.drafts.messages[target.key]).toBe('远程输入');
});
it('rejects a retained preview after real repository versionchange without changing pending drafts or state',async()=>{
 const {c,target,port,factory}=await setup();const request=issueVoiceDraftRequest(c,target);const preview=previewVoiceDraft(request,'函数',c,port);const before=c.pendingDocument();
 const upgrade=factory.open('growth-workbench',2);
 await new Promise<void>((resolve,reject)=>{upgrade.onsuccess=()=>{upgrade.result.close();resolve();};upgrade.onerror=()=>reject(upgrade.error);});
 expect(c.storageStatus()).toBe('unavailable');const result=appendReviewedVoiceDraft(preview,c,port);
 expect(result.applied).toBe(false);await expect(result.saving).rejects.toMatchObject({code:'unavailable'});
 expect(c.pendingDocument()).toEqual(before);expect(c.pendingDocument().drafts.messages).toEqual({'question:column-a':'原文'});
 expect(c.pendingDocument().state).toEqual(before.state);
});
it.each([false,true])('rejects an old preview when the current review replaces the handle: %s',async(newRequest)=>{
 const {c,target,port}=await setup();const request=issueVoiceDraftRequest(c,target);const old=previewVoiceDraft(request,'旧文字',c,port);
 const current=previewVoiceDraft(newRequest?issueVoiceDraftRequest(c,target):request,'已检查的新文字',c,port);
 const stale=appendReviewedVoiceDraft(old,c,port);expect(stale.applied).toBe(false);await expect(stale.saving).rejects.toMatchObject({code:'invalid'});
 expect(c.pendingDocument().drafts.messages['question:column-a']).toBe('原文');
 const result=appendReviewedVoiceDraft(current,c,port);expect(result.applied).toBe(true);await result.saving;
 expect(c.pendingDocument().drafts.messages['question:column-a']).toBe('原文\n已检查的新文字');
});
it('rechecks the current preview after synchronous lease subscribers replace it',async()=>{
 const {c,target,port}=await setup();const request=issueVoiceDraftRequest(c,target);const old=previewVoiceDraft(request,'旧文字',c,port);
 let current:ReturnType<typeof previewVoiceDraft>|undefined;
 const stop=c.subscribe(()=>{if(c.isBusy()&&!current)current=previewVoiceDraft(issueVoiceDraftRequest(c,target),'已检查的新文字',c,port);});
 const stale=appendReviewedVoiceDraft(old,c,port);stop();expect(stale.applied).toBe(false);await expect(stale.saving).rejects.toMatchObject({code:'invalid'});
 expect(c.pendingDocument().drafts.messages['question:column-a']).toBe('原文');
 const result=appendReviewedVoiceDraft(current!,c,port);expect(result.applied).toBe(true);await result.saving;
 expect(c.pendingDocument().drafts.messages['question:column-a']).toBe('原文\n已检查的新文字');
});
it('applies one request once through reentrant clicks and multiple previews',async()=>{
 const {c,target,port}=await setup();const request=issueVoiceDraftRequest(c,target);const one=previewVoiceDraft(request,'函数',c,port);const two=previewVoiceDraft(request,'函数',c,port);
 let duplicate:ReturnType<typeof appendReviewedVoiceDraft>|undefined;
 const stop=c.subscribe(()=>{if(!duplicate&&c.pendingDocument().drafts.messages['question:column-a']==='原文\n函数'){
  expect(()=>previewVoiceDraft(request,'函数',c,port)).toThrow();
  duplicate=appendReviewedVoiceDraft(one,c,port);void duplicate.saving.catch(()=>{});
 }});
 const result=appendReviewedVoiceDraft(two,c,port);await result.saving;stop();expect(duplicate?.applied).toBe(false);await expect(duplicate!.saving).rejects.toMatchObject({code:'invalid'});
 const repeated=appendReviewedVoiceDraft(two,c,port);expect(repeated.applied).toBe(false);await expect(repeated.saving).rejects.toMatchObject({code:'invalid'});
 expect(()=>previewVoiceDraft(request,'函数',c,port)).toThrow();expect(c.pendingDocument().drafts.messages['question:column-a']).toBe('原文\n函数');
});
it('old saving finalization never revives its handle or clears a newer current preview',async()=>{
 const {c,target,port}=await setup();const request=issueVoiceDraftRequest(c,target);const old=previewVoiceDraft(request,'函数',c,port);
 let next:ReturnType<typeof issueVoiceDraftRequest>|undefined,current:ReturnType<typeof previewVoiceDraft>|undefined;
 const stop=c.subscribe(()=>{if(!next&&c.pendingDocument().drafts.messages[target.key]==='原文\n函数'){
  next=issueVoiceDraftRequest(c,target);current=previewVoiceDraft(next,'参数',c,port);
 }});
 const result=appendReviewedVoiceDraft(old,c,port);expect(result.applied).toBe(true);await result.saving;stop();
 expect(()=>previewVoiceDraft(request,'旧文字',c,port)).toThrow();retireVoiceDraftRequest(request);
 const appended=appendReviewedVoiceDraft(current!,c,port);expect(appended.applied).toBe(true);await appended.saving;
 expect(c.pendingDocument().drafts.messages[target.key]).toBe('原文\n函数\n参数');
});
it('retains the quota candidate and only retries its existing save',async()=>{
 const {c,r,target,port}=await setup();const request=issueVoiceDraftRequest(c,target);const preview=previewVoiceDraft(request,'函数',c,port);const put=IDBObjectStore.prototype.put;
 const spy=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args:Parameters<typeof put>){if(this.name==='document')throw new DOMException('full','QuotaExceededError');return put.apply(this,args);});
 const result=appendReviewedVoiceDraft(preview,c,port);expect(result.applied).toBe(true);expect(c.pendingDocument().drafts.messages['question:column-a']).toBe('原文\n函数');
 expect(()=>previewVoiceDraft(request,'函数',c,port)).toThrow();
 await expect(result.saving).rejects.toMatchObject({code:'quota'});expect(c.hasPending()).toBe(true);expect(c.isBusy()).toBe(false);
 const repeated=appendReviewedVoiceDraft(preview,c,port);expect(repeated.applied).toBe(false);await expect(repeated.saving).rejects.toMatchObject({code:'invalid'});
 spy.mockRestore();await c.change(d=>d);await c.flush();expect((await r.load()).document.drafts.messages['question:column-a']).toBe('原文\n函数');expect(()=>previewVoiceDraft(request,'函数',c,port)).toThrow();
});
it('enforces the 20000-character boundary atomically including the separator',async()=>{
 const {c,target,port}=await setup({text:'a'.repeat(19999)});const request=issueVoiceDraftRequest(c,target);const preview=previewVoiceDraft(request,'字',c,port);
 const result=appendReviewedVoiceDraft(preview,c,port);expect(result.applied).toBe(false);await expect(result.saving).rejects.toMatchObject({code:'invalid'});expect(c.pendingDocument().drafts.messages['question:column-a']).toBe('a'.repeat(19999));
 await c.change(setDraft('question:column-a','a'.repeat(19998)));const exact=appendReviewedVoiceDraft(previewVoiceDraft(request,'字',c,port),c,port);await exact.saving;expect(exact.applied).toBe(true);expect(c.pendingDocument().drafts.messages['question:column-a']).toBe('a'.repeat(19998)+'\n字');
});
it('rejects copied or foreign-controller previews without touching either draft',async()=>{
 const {c,target,port}=await setup();const request=issueVoiceDraftRequest(c,target);const preview=previewVoiceDraft(request,'函数',c,port);
 const copy=appendReviewedVoiceDraft({...preview,transcript:'changed'},c,port);expect(copy.applied).toBe(false);await expect(copy.saving).rejects.toMatchObject({code:'invalid'});
 const other=await setup();const foreign=appendReviewedVoiceDraft(preview,other.c,other.port);expect(foreign.applied).toBe(false);await expect(foreign.saving).rejects.toMatchObject({code:'invalid'});
 expect(c.pendingDocument().drafts.messages['question:column-a']).toBe('原文');expect(other.c.pendingDocument().drafts.messages['question:column-a']).toBe('原文');
});
