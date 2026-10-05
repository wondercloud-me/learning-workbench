// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {IDBFactory} from 'fake-indexeddb';
import {BrowserApp} from '../src/browser/app';
import {createBrowserController, type BrowserController} from '../src/browser/controller';
import {openBrowserRepository, BrowserStorageError} from '../src/browser/repository';
import {emptyBrowserDocument} from '../src/core/browser-state';
import {beginStudy, confirmPlan, createColumn} from '../src/core/learning';
import {createBackup} from '../src/core/backup';
import resources from '../src/browser/voice/resources.json';
import {createBrowserVoiceCoordinator} from '../src/browser/voice/coordinator';

const boundary=vi.hoisted(()=>({workers:[] as any[],contexts:[] as any[],nodes:[] as any[],permissions:[] as any[],store:null as any,readiness:null as any,update:vi.fn(),chat:vi.fn(),reader:null as any}));
vi.mock('../src/renderer/lab-client',()=>({executeLab:async()=>{throw Error('This voice fixture does not execute code.');}}));
vi.mock('../src/core/model-session',()=>({createModelSession:()=>({chat:boundary.chat,compact:async()=>{},test:async()=>'',clear:()=>{},dispose:()=>{}})}));
vi.mock('../src/browser/pwa',()=>({registerBrowserPwa:async(_base:string,readiness:unknown)=>{
 boundary.readiness=readiness;return{status:()=>({phase:'update-waiting',install:'unsupported',message:'fixture'}),subscribe:()=>()=>{},requestUpdate:boundary.update,dispose:()=>{},install:async()=> 'unsupported'};
}}));
vi.mock('../src/browser/voice/model-store',()=>({createVoiceModelStore:()=>boundary.store}));
vi.mock('../src/browser/voice/platform',()=>({createBrowserVoicePlatform:()=>({
 createWorker:()=>{const worker=new WorkerFixture();boundary.workers.push(worker);return worker;},
 createAudioContext:()=>{const context=new ContextFixture();boundary.contexts.push(context);return context;},
 createCaptureNode:async()=>{const node=new NodeFixture();boundary.nodes.push(node);return node;},
 mediaDevices:{getUserMedia:()=>{const pending=deferred<any>();boundary.permissions.push(pending);return pending.promise;}},
 clock:{now:()=>performance.now(),setTimeout:(fn:()=>void,ms:number)=>setTimeout(fn,ms),clearTimeout:(handle:number)=>clearTimeout(handle)},
 lifecycle:{current:()=>document.visibilityState==='visible',subscribe:()=>()=>{}},
})}));
vi.mock('../src/browser/speech',async()=>{
 const actual=await vi.importActual<any>('../src/browser/speech');
 return {...actual,createBrowserReader:()=>boundary.reader};
});
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const deferred=<T,>()=>{let resolve!:(value:T)=>void,reject!:(cause:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
class WorkerFixture {onmessage:any=null;onerror:any=null;onmessageerror:any=null;messages:any[]=[];terminated=0;postMessage(data:any){this.messages.push(data);}terminate(){this.terminated++;}emit(data:any){this.onmessage?.({data});}}
class NodeFixture {disconnected=0;onprocessorerror:any=null;messages:any[]=[];port={onmessage:null as any,onmessageerror:null as any,postMessage:(value:any)=>this.messages.push(value),close:()=>{}};connect(){}disconnect(){this.disconnected++;}emit(data:any){this.port.onmessage?.({data});}}
class ContextFixture {sampleRate=48000;state='running';destination={};resume=async()=>{};close=async()=>{this.state='closed';};createMediaStreamSource=()=>({connect:()=>{},disconnect:()=>{}});}
const nativeStream=()=>{const calls=[0,0];return{value:{getTracks:()=>calls.map((_,i)=>({stop:()=>{calls[i]++;}}))},calls};};
const mounted:Array<{root:Root;host:HTMLElement;controller:BrowserController}>=[];
afterEach(async()=>{for(const item of mounted.splice(0)){await act(async()=>item.root.unmount());item.controller.close();item.host.remove();}vi.unstubAllGlobals();vi.restoreAllMocks();});
const buildId='ui-fixture',base=import.meta.env.BASE_URL;
const manifest={schemaVersion:1,buildId,basePath:`${base}optional-asr/1.13.8/${buildId}/`,modelKind:'senseVoice',runtimeVersion:'1.13.8',files:[...resources.files.map(f=>({role:f.role,filename:f.filename,bytes:f.bytes,sha256:f.sha256})),{role:'worker',filename:'runtime.worker.js',bytes:11355,sha256:'a'.repeat(64)},{role:'worklet',filename:'capture.worklet.js',bytes:3074,sha256:'b'.repeat(64)}].map(f=>({...f,url:`${base}optional-asr/1.13.8/${buildId}/${f.filename}`,downloadUrl:`${base}optional-asr/1.13.8/${buildId}/${f.filename}?wb-asr-download=1`}))};
const drain=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
beforeEach(()=>{
 boundary.workers=[];boundary.contexts=[];boundary.nodes=[];boundary.permissions=[];boundary.chat=vi.fn(async()=> 'fixture reply');boundary.update=vi.fn(async()=>false);
 let ready=false;boundary.store={status:()=>ready?'ready':'missing',download:vi.fn(async(progress:any)=>{progress?.({receivedBytes:254844925,totalBytes:254844925,currentFile:'capture.worklet.js',fileReceivedBytes:3074,fileTotalBytes:3074});ready=true;}),cancel:vi.fn(async()=>{}),delete:vi.fn(async()=>{ready=false;}),load:vi.fn(async()=>Object.fromEntries(['glue','wasm','wrapper','model','tokens','worker','worklet'].map(role=>[role,new ArrayBuffer(4)])))};
 let reading:any=null;const listeners=new Set<()=>void>();const notify=()=>listeners.forEach(f=>f());
 boundary.reader={snapshot:()=>({supported:true,voices:[],voicePhase:'ready',phase:reading?'speaking':'idle',active:reading,errorCode:null,notice:'fixture',effectiveVoice:null}),subscribe:(f:()=>void)=>{listeners.add(f);return()=>listeners.delete(f);},stop:()=>{reading=null;notify();},read:()=>{reading={scope:'preview',itemId:'voice-preview',chunk:1,chunks:1};notify();},refreshVoices:()=>{},dispose:()=>{listeners.clear();}};
 vi.stubGlobal('__WB_BROWSER_ASR_ENABLED__',true);vi.stubGlobal('__WB_BROWSER_BUILD_ID__',buildId);
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(manifest),{headers:{'Content-Type':'application/json'}})));
 vi.stubGlobal('caches',{});Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});
});
async function mount(enabled=true){
 vi.stubGlobal('__WB_BROWSER_ASR_ENABLED__',enabled);
 const repository=await openBrowserRepository(new IDBFactory());const initial=emptyBrowserDocument(),now='2026-10-05T00:00:00.000Z';
 initial.state.onboarding.introSeen=true;initial.state.columns=['c','other'].map(id=>beginStudy(confirmPlan(createColumn(id,'函数',now,id),{target:'函数',steps:[{id:'step-'+id,title:'参数',outcome:'能用函数',priority:1}]},now)));initial.state.activeColumnId='c';initial.drafts.messages['question:c']='原草稿';
 await repository.commit(initial,0);const controller=await createBrowserController(repository),host=document.createElement('div');document.body.append(host);const root=createRoot(host);mounted.push({root,host,controller});
 await act(async()=>root.render(<BrowserApp controller={controller}/>));
 const click=async(label:string,scope:ParentNode=host)=>{const button=[...scope.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.trim()===label);expect(button,`button ${label}`).toBeTruthy();await act(async()=>{button!.click();await drain();});};
 const type=async(label:string,value:string)=>{const field=host.querySelector<HTMLTextAreaElement|HTMLSelectElement>(`[aria-label="${label}"]`)!;expect(field).toBeTruthy();await act(async()=>{Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field),'value')!.set!.call(field,value);field.dispatchEvent(new Event(field.tagName==='SELECT'?'change':'input',{bubbles:true}));await controller.flush();});};
 return{root,host,controller,repository,click,type};
}
type Ui=Awaited<ReturnType<typeof mount>>;
const openReading=(ui:Ui)=>{const panel=ui.host.querySelector<HTMLDetailsElement>('[aria-label="手动朗读"] details');expect(panel).toBeTruthy();panel!.open=true;};
const columnHost=(ui:Ui,id='c')=>ui.host.querySelector<HTMLElement>(`[data-teaching-column="${id}"]`)!;
async function ready(ui:Ui){await ui.click('设置');await ui.click('检查本地语音资源');expect(fetch).toHaveBeenCalledTimes(1);expect(boundary.store.load).not.toHaveBeenCalled();await ui.click('下载模型到本机');await ui.click('学习');await ui.click('可选 AI 教学');}
async function permission(ui:Ui){await ui.click('开始本地录音',columnHost(ui));const worker=boundary.workers.at(-1)!;const id=worker.messages.find((m:any)=>m.type==='init').requestId;await act(async()=>{worker.emit({type:'ready',requestId:id,heapBufferBytes:536870912});await drain();});return{worker,id};}
async function recording(ui:Ui){const request=await permission(ui),stream=nativeStream();await act(async()=>{boundary.permissions.at(-1)!.resolve(stream.value);await drain();});return{...request,stream,node:boundary.nodes.at(-1)!};}
async function review(ui:Ui){const active=await recording(ui);await act(async()=>active.node.emit({type:'pcm',captureId:active.id,sampleRate:48000,totalSamples:2,pcm:new Float32Array([.25,.5])}));await ui.click('停止并转写',columnHost(ui));await act(async()=>{active.node.emit({type:'flushed',captureId:active.id,sampleRate:48000,totalSamples:2});active.worker.emit({type:'result',requestId:active.id,text:'函数接收参数'});await drain();});return active;}

it('default off and enabled first mount make no ASR resource, cache, Worker or permission request',async()=>{
 const closed=await mount(false);expect(closed.host.querySelector('[aria-label="本地语音下载"]')).toBeNull();expect(fetch).not.toHaveBeenCalled();
 const ui=await mount();await ui.click('设置');expect(ui.host.querySelector('[aria-label="本地语音下载"]')).toBeTruthy();expect(fetch).not.toHaveBeenCalled();expect(boundary.store.download).not.toHaveBeenCalled();expect(boundary.store.load).not.toHaveBeenCalled();expect(boundary.workers).toHaveLength(0);expect(boundary.permissions).toHaveLength(0);
});
it('checks manifest explicitly and separates exact bytes/license display from manual model download',async()=>{
 const ui=await mount();await ui.click('设置');await ui.click('检查本地语音资源');expect(ui.host.textContent).toContain('254,844,925');expect(ui.host.textContent).toContain('FunASR');expect(ui.host.textContent).toContain('Apache-2.0');expect(boundary.store.download).not.toHaveBeenCalled();expect(boundary.store.load).not.toHaveBeenCalled();await ui.click('下载模型到本机');expect(boundary.store.download).toHaveBeenCalledTimes(1);expect(boundary.workers).toHaveLength(0);expect(boundary.permissions).toHaveLength(0);
});
it('keeps typed text during its own voice lease and appends only a current reviewed draft without sending',async()=>{
 const ui=await mount();await ready(ui);const active=await recording(ui);expect(ui.controller.isBusy()).toBe(true);await ui.type('向 AI 提问','录音期间输入');
 await act(async()=>active.node.emit({type:'pcm',captureId:active.id,sampleRate:48000,totalSamples:1,pcm:new Float32Array([.5])}));await ui.click('停止并转写',columnHost(ui));await act(async()=>{active.node.emit({type:'flushed',captureId:active.id,sampleRate:48000,totalSamples:1});active.worker.emit({type:'result',requestId:active.id,text:'函数'});await drain();});
 expect(ui.controller.pendingDocument().drafts.messages['question:c']).toBe('录音期间输入');expect(createBackup(ui.controller.pendingDocument(),'0.10.0','2026-10-05T00:00:00.000Z').browser.drafts.messages['question:c']).toBe('录音期间输入');await ui.type('向 AI 提问','预览之后输入');await ui.click('确认追加到草稿',columnHost(ui));expect(ui.controller.pendingDocument().drafts.messages['question:c']).toBe('预览之后输入');await ui.click('重新预览追加',columnHost(ui));await ui.click('确认追加到草稿',columnHost(ui));await ui.controller.flush();expect(ui.controller.pendingDocument().drafts.messages['question:c']).toBe('预览之后输入\n函数');expect(boundary.chat).not.toHaveBeenCalled();expect(ui.controller.pendingDocument().state.columns[0].evidence).toEqual([]);expect(ui.controller.pendingDocument().state.usageRecords).toEqual([]);
});
it.each(['route','column','mode','phase'])('cancels on %s before mutation and refuses a retained hidden or previous-scope start handler',async(kind)=>{
 const ui=await mount();await ready(ui);const button=[...columnHost(ui).querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='开始本地录音')!;const key=Object.keys(button).find(key=>key.startsWith('__reactProps'))!;const retained=(button as any)[key].onClick;
 const old=await permission(ui);
 if(kind==='route')await ui.click('记录');if(kind==='column')await ui.type('当前教学栏目','other');if(kind==='mode')await ui.click('材料提问',columnHost(ui));if(kind==='phase')await ui.click('这块已学过',columnHost(ui));
 await act(async()=>{retained();await drain();});expect(old.worker.terminated).toBe(1);expect(boundary.workers).toHaveLength(1);expect(boundary.permissions).toHaveLength(1);const late=nativeStream();await act(async()=>{boundary.permissions[0].resolve(late.value);await drain();});expect(late.calls).toEqual([1,1]);expect(ui.controller.isBusy()).toBe(false);expect(ui.controller.pendingDocument().drafts.messages['question:c']).toBe('原草稿');
});
it('does not repeat an applied pending append after quota failure',async()=>{
 const ui=await mount();await ready(ui);await review(ui);const button=[...columnHost(ui).querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='确认追加到草稿')!;const props=Object.keys(button).find(k=>k.startsWith('__reactProps'))!;const retained=(button as any)[props].onClick;
 const commit=ui.repository.commit;ui.repository.commit=async()=>{throw new BrowserStorageError('quota','full');};await ui.click('确认追加到草稿',columnHost(ui));await act(async()=>{retained();await drain();});expect(ui.controller.pendingDocument().drafts.messages['question:c']).toBe('原草稿\n函数接收参数');ui.repository.commit=commit;await act(async()=>{await ui.controller.change(d=>d);await ui.controller.flush();});expect(ui.controller.pendingDocument().drafts.messages['question:c']).toBe('原草稿\n函数接收参数');expect(boundary.chat).not.toHaveBeenCalled();
});
it('manual reading cancels pending capture and deleting resources cancels before optional storage removal',async()=>{
 const ui=await mount();await ready(ui);openReading(ui);const old=await permission(ui);await ui.click('试听声音');expect(old.worker.terminated).toBe(1);expect(ui.controller.isBusy()).toBe(false);await ui.click('设置');await ui.click('删除本地语音下载');expect(boundary.store.delete).toHaveBeenCalledTimes(1);expect(boundary.workers).toHaveLength(1);expect(boundary.chat).not.toHaveBeenCalled();
});
it('holds update readiness during independent download and explicitly cancels before requesting update',async()=>{
 const ui=await mount();await ui.click('设置');await ui.click('检查本地语音资源');const download=deferred<void>();boundary.store.download=vi.fn(()=>download.promise);await ui.click('下载模型到本机');expect(boundary.readiness.isBusy()).toBe(true);boundary.store.cancel=vi.fn(async()=>download.reject(Error('cancelled')));await ui.click('保存并更新');expect(boundary.store.cancel).toHaveBeenCalled();expect(boundary.update).toHaveBeenCalledTimes(1);expect(boundary.readiness.isBusy()).toBe(false);
});
it('blocks backup replacement during resource work, then restores without allowing the old confirmation handler',async()=>{
 const ui=await mount();await ready(ui);await review(ui);
 const button=[...columnHost(ui).querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='确认追加到草稿')!;
 const props=Object.keys(button).find(k=>k.startsWith('__reactProps'))!,retained=(button as any)[props].onClick;
 await ui.click('设置');
 const replacement=emptyBrowserDocument();replacement.state.onboarding.introSeen=true;
 const file=new File(['fixture'],'restore.json');Object.defineProperty(file,'text',{value:async()=>JSON.stringify(createBackup(replacement,'0.10.0','2026-10-05T00:00:00.000Z'))});
 const input=ui.host.querySelector<HTMLInputElement>('[aria-label="选择备份文件"]')!;
 await act(async()=>{Object.defineProperty(input,'files',{value:[file],configurable:true});input.dispatchEvent(new Event('change',{bubbles:true}));await drain();});
 const pending=deferred<void>();boundary.store.download=vi.fn(()=>pending.promise);await ui.click('下载模型到本机');
 await ui.click('确认恢复备份');expect(ui.controller.pendingDocument().state.activeColumnId).toBe('c');expect(ui.host.textContent).toContain('请先等待或取消语音资源操作');
 boundary.store.cancel=vi.fn(async()=>pending.reject(Error('cancelled')));await ui.click('取消语音下载');
 await ui.click('确认恢复备份');await act(async()=>{await vi.waitFor(()=>expect(ui.controller.pendingDocument().state.columns).toEqual([]));});
 await act(async()=>{retained();await drain();});expect(ui.controller.pendingDocument().drafts.messages).toEqual({});expect(boundary.chat).not.toHaveBeenCalled();
});
it('refuses reading after unconfirmed Worker teardown and does not clear the latch by checking or deleting resources',async()=>{
 const ui=await mount();await ready(ui);openReading(ui);const old=await permission(ui);old.worker.terminate=()=>{throw Error('native cleanup fixture');};
 const read=vi.spyOn(boundary.reader,'read');await ui.click('试听声音');expect(read).not.toHaveBeenCalled();expect(ui.host.textContent).toContain('重新加载页面');
 await ui.click('设置');await ui.click('检查本地语音资源');await ui.click('删除本地语音下载');await ui.click('下载模型到本机');await ui.click('学习');await ui.click('可选 AI 教学');
 await ui.click('试听声音');expect(read).not.toHaveBeenCalled();expect(boundary.workers).toHaveLength(1);expect(boundary.permissions).toHaveLength(1);
});
it('resource admission independently checks the resource port before reserving or fetching',async()=>{
 const ui=await mount();let allowed=false;
 const voice=createBrowserVoiceCoordinator({enabled:true,base,buildId,controller:ui.controller,eligible:()=>false,resourceAllowed:()=>allowed,stopReading:()=>true});
 await voice.check();expect(fetch).not.toHaveBeenCalled();expect(voice.busy()).toBe(false);
 allowed=true;await voice.check();expect(fetch).toHaveBeenCalledTimes(1);allowed=false;
 for(const operation of [voice.check,voice.download,voice.verify,voice.delete]){const pending=operation();expect(voice.busy()).toBe(false);await pending;}
 expect(boundary.store.download).not.toHaveBeenCalled();expect(boundary.store.load).not.toHaveBeenCalled();expect(boundary.store.delete).not.toHaveBeenCalled();voice.dispose();
});
it.each(['update','restore','hidden','version'])('refuses retained resource handlers after %s while keeping current controls usable',async(kind)=>{
 const ui=await mount();await ui.click('设置');await ui.click('检查本地语音资源');
 const card=ui.host.querySelector<HTMLElement>('[aria-label="本地语音下载"]')!;
 const retain=(label:string)=>{const button=[...card.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent===label)!;const props=Object.keys(button).find(key=>key.startsWith('__reactProps'))!;return(button as any)[props].onClick;};
 const old=[retain('下载模型到本机'),retain('检查已有模型缓存'),retain('删除本地语音下载')];let release=()=>{};
 if(kind==='update')await act(async()=>{release=boundary.readiness.acquireUpdateLock();});
 if(kind==='restore'){
  const pending=deferred<any>();vi.spyOn(ui.controller,'replace').mockImplementation(()=>pending.promise);
  const file=new File(['fixture'],'restore.json');Object.defineProperty(file,'text',{value:async()=>JSON.stringify(createBackup(ui.controller.pendingDocument(),'0.10.0','2026-10-05T00:00:00.000Z'))});
  const input=ui.host.querySelector<HTMLInputElement>('[aria-label="选择备份文件"]')!;
  await act(async()=>{Object.defineProperty(input,'files',{value:[file],configurable:true});input.dispatchEvent(new Event('change',{bubbles:true}));await drain();});
  await ui.click('确认恢复备份');release=()=>pending.resolve(ui.controller.snapshot());
 }
 if(kind==='hidden')card.hidden=true;
 if(kind==='version'){await ui.click('记录');await ui.click('设置');}
 await act(async()=>{for(const handler of old){handler();await drain();}});
 expect(boundary.store.download).not.toHaveBeenCalled();expect(boundary.store.load).not.toHaveBeenCalled();expect(boundary.store.delete).not.toHaveBeenCalled();expect(boundary.workers).toHaveLength(0);expect(boundary.permissions).toHaveLength(0);
 await act(async()=>{release();await drain();});if(kind==='hidden')card.hidden=false;
 await ui.click('下载模型到本机');expect(boundary.store.download).toHaveBeenCalledTimes(1);
});
