import {afterEach, expect, it, vi} from 'vitest';
import {IDBFactory, IDBObjectStore} from 'fake-indexeddb';
import {createBrowserController, type BrowserController} from '../src/browser/controller';
import {openBrowserRepository} from '../src/browser/repository';
import {beginStudy, confirmPlan, createColumn} from '../src/core/learning';
import {createBrowserVoiceService, type BrowserVoiceService, type VoiceServicePorts} from '../src/browser/voice/service';
import type {VoiceDraftTarget} from '../src/browser/voice/types';
import type {VoiceManifest, VoiceResourceRole} from '../src/browser/voice/manifest';

const cleanup: (() => void)[] = [];
afterEach(() => {cleanup.splice(0).reverse().forEach(fn => fn()); vi.restoreAllMocks();});
const deferred = <T>() => {let resolve!: (value: T) => void; let reject!: (cause: unknown) => void; const promise = new Promise<T>((yes,no) => {resolve=yes;reject=no;}); return {promise,resolve,reject};};
const drain = async () => {for(let index=0;index<24;index++) await Promise.resolve();};
class Clock {
  time=0; next=0; timers=new Map<number,{at:number;fn:()=>void}>();
  now=()=>this.time;
  setTimeout=(fn:()=>void,ms:number)=>{const id=++this.next;this.timers.set(id,{at:this.time+ms,fn});return id;};
  clearTimeout=(id:unknown)=>{this.timers.delete(id as number);};
  advance(ms:number){this.time+=ms;for(const [id,timer] of [...this.timers])if(timer.at<=this.time){this.timers.delete(id);timer.fn();}}
}
class WorkerDouble {
  onmessage: ((event: MessageEvent) => void) | null=null; onerror: ((event: ErrorEvent) => void) | null=null;
  onmessageerror: ((event: MessageEvent) => void) | null=null; messages:any[]=[]; terminated=0;
  postMessage(value:unknown,transfer:Transferable[]=[]){this.messages.push(structuredClone(value,{transfer}));}
  terminate(){this.terminated++;}
  emit(data:unknown){this.onmessage?.({data} as MessageEvent);}
}
class CaptureDouble {
  messages:any[]=[]; disconnected=0; closed=0; onprocessorerror: ((event: Event) => void) | null=null;
  port={onmessage:null as ((event:MessageEvent)=>void)|null,onmessageerror:null as ((event:MessageEvent)=>void)|null,
    postMessage:(value:unknown)=>{this.messages.push(value);},close:()=>{this.closed++;}};
  connect(){} disconnect(){this.disconnected++;}
  emit(data:unknown){this.port.onmessage?.({data} as MessageEvent);}
}
class ContextDouble {
  sampleRate=48000; state='running'; destination={}; closed=0; disconnected=0; resumeCalls=0;
  closing?:Promise<void>; closeFailure=false;
  resume=()=>{this.resumeCalls++;return Promise.resolve();};
  close=()=>{this.closed++;if(this.closeFailure)throw Error('close failed');if(this.closing)return this.closing;this.state='closed';return Promise.resolve();};
  createMediaStreamSource=()=>({connect:()=>{},disconnect:()=>{this.disconnected++;}});
}
function stream(throwFirst=false){const calls=[0,0];const tracks=calls.map((_,index)=>({stop:()=>{calls[index]++;if(throwFirst&&index===0)throw Error('track stop failed');}}));return {value:{getTracks:()=>tracks} as unknown as MediaStream,calls};}
async function fixture() {
  const now='2026-10-05T10:00:00.000Z';const repo=await openBrowserRepository(new IDBFactory(),()=>now);
  const controller=await createBrowserController(repo);cleanup.push(()=>{controller.close();repo.close();});
  const column=beginStudy(confirmPlan(createColumn('编程','函数',now,'column-a'),{target:'函数',steps:[{id:'step-a',title:'参数',outcome:'能修改函数',priority:1}]},now));
  await controller.change(document=>({...document,state:{...document.state,onboarding:{...document.state.onboarding,introSeen:true},columns:[column],activeColumnId:column.id},drafts:{...document.drafts,messages:{'question:column-a':'原文'}}}));
  const target:VoiceDraftTarget={page:'learn',learningView:'teaching',columnId:column.id,sideId:null,mode:'question',key:'question:column-a',phase:column.phase,stepId:'step-a',documentGeneration:controller.documentGeneration(),scopeVersion:0};
  const ui={target:target as VoiceDraftTarget|null,visible:true,composing:false};
  const clock=new Clock(),workers:WorkerDouble[]=[],contexts:ContextDouble[]=[],nodes:CaptureDouble[]=[],order:string[]=[];
  const permissions:ReturnType<typeof deferred<MediaStream>>[]=[];const lifeListeners=new Set<()=>void>();let visible=true;
  const roles:VoiceResourceRole[]=['glue','wasm','wrapper','model','tokens','worker','worklet'];
  const manifest:VoiceManifest={schemaVersion:1,buildId:'fixture',basePath:'/learn/optional-asr/1.13.8/fixture/',modelKind:'senseVoice',runtimeVersion:'1.13.8',files:roles.map(role=>({role,filename:role+'.js',url:'/learn/'+role,downloadUrl:'/learn/'+role,bytes:4,sha256:'a'.repeat(64)}))};
  const resources={status:()=> 'ready' as const,load:async()=>{order.push('load');return Object.fromEntries(roles.map(role=>[role,new ArrayBuffer(4)])) as Record<VoiceResourceRole,ArrayBuffer>;}};
  const reading={stopAndConfirm:()=>{order.push('reading');return true;}};
  const ports:VoiceServicePorts={controller,draftPort:{target:()=>ui.target,current:()=>ui.visible,composing:()=>ui.composing},reading,resources,manifest,clock,
    createWorker:()=>{order.push('worker');const worker=new WorkerDouble();workers.push(worker);return worker as unknown as Worker;},
    mediaDevices:{getUserMedia:()=>{order.push('permission');const permission=deferred<MediaStream>();permissions.push(permission);return permission.promise;}},
    createAudioContext:()=>{order.push('context');const context=new ContextDouble();const resume=context.resume;context.resume=()=>{order.push('resume');return resume();};contexts.push(context);return context as unknown as AudioContext;},
    createCaptureNode:async()=>{const node=new CaptureDouble();nodes.push(node);return node as unknown as AudioWorkletNode;},
    lifecycle:{current:()=>visible,subscribe:listener=>{lifeListeners.add(listener);return()=>lifeListeners.delete(listener);}},
  };
  const service=createBrowserVoiceService(ports);cleanup.push(()=>service.dispose());
  const life=(current:boolean)=>{visible=current;for(const listener of [...lifeListeners])listener();};
  return {controller,target,ui,clock,workers,contexts,nodes,permissions,order,ports,service,life};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function permission(f:Fixture){expect(f.service.start().accepted).toBe(true);await drain();const worker=f.workers.at(-1)!;const requestId=f.service.snapshot().requestId!;worker.emit({type:'ready',requestId,heapBufferBytes:536870912});await drain();expect(f.service.snapshot().phase).toBe('permission');return {worker,requestId};}
async function recording(f:Fixture){const request=await permission(f);const audio=stream();f.permissions.at(-1)!.resolve(audio.value);await drain();expect(f.service.snapshot().phase).toBe('recording');return {...request,audio,node:f.nodes.at(-1)!};}
function pcm(node:CaptureDouble,id:number,values:number[],total=values.length){node.emit({type:'pcm',captureId:id,sampleRate:48000,totalSamples:total,pcm:new Float32Array(values)});}
async function recognizing(f:Fixture){const active=await recording(f);pcm(active.node,active.requestId,[.25,.5]);f.service.stop();active.node.emit({type:'flushed',captureId:active.requestId,sampleRate:48000,totalSamples:2});await drain();expect(f.service.snapshot().phase).toBe('recognizing');return active;}
async function review(f:Fixture){const active=await recognizing(f);active.worker.emit({type:'result',requestId:active.requestId,text:'函数可以接收参数'});await drain();expect(f.service.snapshot().phase).toBe('review');return active;}
const draft=(c:BrowserController,text:string)=>c.change(document=>({...document,drafts:{...document.drafts,messages:{...document.drafts.messages,'question:column-a':text}}}));

it('reserves before lease notifications and cancels a reentrant start without arming audio or permission',async()=>{
  const f=await fixture();const unsubscribe=f.controller.subscribe(()=>{if(f.controller.isBusy())f.service.cancel('scope');});
  f.service.start();unsubscribe();await drain();expect(f.controller.isBusy()).toBe(false);expect(f.contexts).toHaveLength(0);expect(f.permissions).toHaveLength(0);expect(f.workers).toHaveLength(0);
});
it('blocks nested starts while a synchronous target guard is still running',async()=>{
  const f=await fixture();let nested:ReturnType<BrowserVoiceService['start']>|undefined,checked=false;const current=f.ports.draftPort.current;
  f.ports.draftPort.current=target=>{if(!checked){checked=true;nested=f.service.start();}return current(target);};
  expect(f.service.start().accepted).toBe(true);expect(nested).toEqual({accepted:false,code:'busy'});expect(f.contexts).toHaveLength(1);await drain();expect(f.workers).toHaveLength(1);
});
it('finishes ownership of a returned context before accepting a reentrant replacement',async()=>{
  const f=await fixture();let nested:ReturnType<BrowserVoiceService['start']>|undefined,cancelled=false;const create=f.ports.createAudioContext;
  f.service.subscribe(()=>{if(cancelled&&!nested&&f.service.snapshot().phase==='idle')nested=f.service.start();});
  f.ports.createAudioContext=()=>{const context=create();if(!cancelled){cancelled=true;f.service.cancel('user');}return context;};
  expect(f.service.start().accepted).toBe(false);expect(nested).toEqual({accepted:false,code:'busy'});await drain();expect(f.contexts).toHaveLength(1);expect(f.contexts[0].closed).toBe(1);expect(f.workers).toHaveLength(0);expect(f.controller.isBusy()).toBe(false);
});
it('creates and resumes audio in the caller stack but waits for verified resources and worker before permission',async()=>{
  const f=await fixture();expect(f.contexts).toHaveLength(0);expect(f.workers).toHaveLength(0);f.service.start();
  expect(f.order.slice(0,3)).toEqual(['reading','context','resume']);expect(f.controller.isBusy()).toBe(true);expect(f.permissions).toHaveLength(0);
  await drain();expect(f.permissions).toHaveLength(0);const id=f.service.snapshot().requestId!;f.workers[0].emit({type:'ready',requestId:id,heapBufferBytes:536870912});await drain();expect(f.permissions).toHaveLength(1);
});
it('refuses failed reading stop and composition before calling permission',async()=>{
  const f=await fixture();f.ports.reading.stopAndConfirm=()=>false;expect(f.service.start().accepted).toBe(false);expect(f.controller.isBusy()).toBe(false);expect(f.contexts).toHaveLength(0);
  f.ports.reading.stopAndConfirm=()=>true;f.ui.composing=true;expect(f.service.start().accepted).toBe(false);expect(f.permissions).toHaveLength(0);
});
it('does not begin cache work or retain a timeout when resume synchronously cancels the request',async()=>{
  const f=await fixture();let loadCalls=0;f.ports.resources.load=async()=>{loadCalls++;throw Error('cancelled load must not run');};
  const create=f.ports.createAudioContext;f.ports.createAudioContext=()=>{const context=create();context.resume=()=>{f.service.cancel('user');return Promise.resolve();};return context;};
  expect(f.service.start().accepted).toBe(false);await drain();expect(loadCalls).toBe(0);expect(f.clock.timers.size).toBe(0);expect(f.controller.isBusy()).toBe(false);expect(f.contexts[0].closed).toBe(1);expect(f.workers).toHaveLength(0);
});
it('releases a pending permission immediately and stops every late track even if one throws',async()=>{
  const f=await fixture();const active=await permission(f);f.service.cancel('user');expect(f.controller.isBusy()).toBe(false);expect(active.worker.terminated).toBe(1);
  const late=stream(true);f.permissions[0].resolve(late.value);await drain();expect(late.calls).toEqual([1,1]);expect(f.service.snapshot().phase).toBe('error');expect(f.service.snapshot().errorCode).toBe('audio-cleanup');expect(f.service.start()).toEqual({accepted:false,code:'audio-cleanup'});expect(active.worker.messages.some(m=>m.type==='transcribe')).toBe(false);
});
it('blocks a new audio context while close is pending without retaining the operation lease',async()=>{
  const f=await fixture();await permission(f);const closing=deferred<void>();f.contexts[0].closing=closing.promise;f.service.cancel('user');
  expect(f.controller.isBusy()).toBe(false);expect(f.service.start().accepted).toBe(false);expect(f.contexts).toHaveLength(1);
  f.contexts[0].state='closed';closing.resolve();await drain();expect(f.service.start().accepted).toBe(true);expect(f.contexts).toHaveLength(2);
});
it('blocks duplicate cache loads after cancellation until the uncancellable load settles',async()=>{
  const f=await fixture();const loading=deferred<Record<VoiceResourceRole,ArrayBuffer>>();let calls=0;f.ports.resources.load=()=>{calls++;return loading.promise;};
  f.service.start();await drain();expect(calls).toBe(1);f.service.cancel('user');await drain();expect(f.service.start().accepted).toBe(false);
  loading.resolve({} as Record<VoiceResourceRole,ArrayBuffer>);await drain();expect(f.workers).toHaveLength(0);expect(f.service.start().accepted).toBe(true);
});
it('drains the partial tail after stopping all tracks and transfers complete PCM exactly once',async()=>{
  const f=await fixture();const active=await recording(f);pcm(active.node,active.requestId,[.25,.5]);f.service.stop();
  expect(active.audio.calls).toEqual([1,1]);expect(active.node.messages).toContainEqual({type:'flush',captureId:active.requestId});expect(active.worker.messages.some(m=>m.type==='transcribe')).toBe(false);
  pcm(active.node,active.requestId,[.75],3);active.node.emit({type:'flushed',captureId:active.requestId,sampleRate:48000,totalSamples:3});await drain();
  const message=active.worker.messages.find(m=>m.type==='transcribe');expect(Array.from(message.pcm)).toEqual([.25,.5,.75]);expect(message.sampleRate).toBe(48000);expect(active.node.closed).toBe(1);expect(f.contexts[0].closed).toBe(1);
  active.node.emit({type:'flushed',captureId:active.requestId,sampleRate:48000,totalSamples:3});f.service.stop();expect(active.worker.messages.filter(m=>m.type==='transcribe')).toHaveLength(1);
});
it('does not resume flushing after stopping a track synchronously cancels the request',async()=>{
  const f=await fixture();const active=await recording(f);active.audio.value.getTracks()[0].stop=()=>{active.audio.calls[0]++;f.service.cancel('user');};
  f.service.stop();await drain();expect(active.audio.calls).toEqual([1,1]);expect(f.service.snapshot().phase).toBe('idle');expect(f.clock.timers.size).toBe(0);expect(active.node.messages.some(message=>message.type==='flush')).toBe(false);expect(active.worker.terminated).toBe(1);expect(f.controller.isBusy()).toBe(false);
});
it.each(['non-finite','range','count','rate','large-chunk'] as const)('rejects %s PCM instead of recognizing a repaired buffer',async(kind)=>{
  const f=await fixture();const active=await recording(f);const message={type:'pcm',captureId:active.requestId,sampleRate:48000,totalSamples:1,pcm:new Float32Array([.5])};
  if(kind==='non-finite')message.pcm[0]=NaN;if(kind==='range')message.pcm[0]=1.1;if(kind==='count')message.totalSamples=2;if(kind==='rate')message.sampleRate=16000;if(kind==='large-chunk'){message.pcm=new Float32Array(2049);message.totalSamples=2049;}
  active.node.emit(message);expect(f.service.snapshot().phase).toBe('error');expect(active.audio.calls).toEqual([1,1]);expect(active.worker.terminated).toBe(1);expect(f.controller.isBusy()).toBe(false);
});
it('does not mistake a sample limit for final PCM and rejects an incomplete limit flush',async()=>{
  const f=await fixture();const active=await recording(f);active.node.emit({type:'limit',captureId:active.requestId,totalSamples:1440000});
  expect(f.service.snapshot().phase).toBe('flushing');expect(active.audio.calls).toEqual([1,1]);active.node.emit({type:'flushed',captureId:active.requestId,sampleRate:48000,totalSamples:0});
  expect(f.service.snapshot().phase).toBe('error');expect(active.worker.messages.some(m=>m.type==='transcribe')).toBe(false);
});
it('continues other cleanup after a track, port or context close throws',async()=>{
  const f=await fixture();const active=await recording(f);const first=active.audio.value.getTracks()[0];first.stop=()=>{active.audio.calls[0]++;throw Error('track');};active.node.port.close=()=>{throw Error('port');};f.contexts[0].closeFailure=true;
  f.service.cancel('user');expect(active.audio.calls).toEqual([1,1]);expect(active.worker.terminated).toBe(1);expect(active.node.disconnected).toBe(1);expect(f.contexts[0].closed).toBe(1);expect(f.controller.isBusy()).toBe(false);expect(f.service.start().accepted).toBe(false);
});
it('blocks replacement allocation after only track.stop fails while context close succeeds',async()=>{
  const f=await fixture();const active=await recording(f);active.audio.value.getTracks()[0].stop=()=>{active.audio.calls[0]++;throw Error('track only');};
  f.service.cancel('user');await drain();expect(active.audio.calls).toEqual([1,1]);expect(active.node.disconnected).toBe(1);expect(active.node.closed).toBe(1);expect(f.contexts[0].state).toBe('closed');expect(active.worker.terminated).toBe(1);expect(f.controller.isBusy()).toBe(false);
  expect(f.service.start()).toEqual({accepted:false,code:'audio-cleanup'});await drain();expect(f.contexts).toHaveLength(1);expect(f.workers).toHaveLength(1);expect(f.service.snapshot().errorCode).toBe('audio-cleanup');f.service.cancel('user');expect(f.service.snapshot().errorCode).toBe('audio-cleanup');
});
it('blocks replacement allocation after only Worker.terminate fails without retrying that owner',async()=>{
  const f=await fixture();const active=await recording(f);const terminate=vi.fn(()=>{throw Error('worker only');});active.worker.terminate=terminate;
  f.service.cancel('user');await drain();expect(active.audio.calls).toEqual([1,1]);expect(active.node.disconnected).toBe(1);expect(active.node.closed).toBe(1);expect(f.contexts[0].state).toBe('closed');expect(active.worker.terminated).toBe(0);expect(f.controller.isBusy()).toBe(false);
  expect(f.service.start()).toEqual({accepted:false,code:'worker-cleanup'});await drain();expect(f.contexts).toHaveLength(1);expect(f.workers).toHaveLength(1);expect(f.service.snapshot().errorCode).toBe('worker-cleanup');f.service.cancel('user');expect(terminate).toHaveBeenCalledTimes(1);expect(f.service.snapshot().errorCode).toBe('worker-cleanup');
});
it.each(['prepare','permission','flush','recognition'] as const)('enforces the %s deadline and frees the operation',async(stage)=>{
  const f=await fixture();let worker:WorkerDouble|undefined;
  if(stage==='prepare'){f.service.start();await drain();worker=f.workers[0];f.clock.advance(120000);}
  if(stage==='permission'){worker=(await permission(f)).worker;f.clock.advance(30000);}
  if(stage==='flush'){const active=await recording(f);worker=active.worker;f.service.stop();f.clock.advance(500);}
  if(stage==='recognition'){worker=(await recognizing(f)).worker;f.clock.advance(60000);}
  await drain();expect(f.service.snapshot().phase).toBe('error');expect(f.controller.isBusy()).toBe(false);expect(worker?.terminated).toBe(1);expect(f.service.snapshot().errorCode).toContain('timeout');
});
it('stops tracks at the recording wall deadline and fails if no final flush arrives',async()=>{
  const f=await fixture();const active=await recording(f);f.clock.advance(30000);expect(active.audio.calls).toEqual([1,1]);expect(f.service.snapshot().phase).toBe('flushing');f.clock.advance(500);expect(f.service.snapshot().phase).toBe('error');
});
it('rejects late results and capture callbacks belonging to a cancelled worker',async()=>{
  const f=await fixture();const old=await recognizing(f);const oldHandler=old.worker.onmessage!;f.service.cancel('scope');await drain();await permission(f);oldHandler({data:{type:'result',requestId:old.requestId,text:'旧结果'}} as MessageEvent);
  expect(f.service.snapshot().phase).toBe('permission');expect(f.service.snapshot().preview).toBeNull();expect(f.controller.pendingDocument().drafts.messages['question:column-a']).toBe('原文');expect(f.workers).toHaveLength(2);
});
it('clears review and resources on visibility loss without automatically restarting',async()=>{
  const f=await fixture();const active=await review(f);expect(f.controller.isBusy()).toBe(false);f.life(false);expect(f.service.snapshot().preview).toBeNull();expect(active.worker.terminated).toBe(1);f.life(true);await drain();expect(f.permissions).toHaveLength(1);
});
it('does not clear a newer request when a previous review target guard cancels and restarts',async()=>{
  const f=await fixture();const old=await review(f);let replaced=false;const current=f.ports.draftPort.current;
  f.ports.draftPort.current=target=>{if(!replaced){replaced=true;f.service.cancel('scope');expect(f.service.start().accepted).toBe(true);return false;}return current(target);};
  expect(()=>f.service.repreview()).toThrow();expect(f.service.snapshot().phase).toBe('preparing');expect(f.service.snapshot().requestId).toBeGreaterThan(old.requestId);expect(f.controller.isBusy()).toBe(true);await drain();expect(f.workers).toHaveLength(2);
});
it('builds review from current typed text, rejects stale confirmation and requires explicit repreview',async()=>{
  const f=await fixture();const active=await recognizing(f);await draft(f.controller,'录音期间输入');active.worker.emit({type:'result',requestId:active.requestId,text:'函数'});await drain();
  const old=f.service.snapshot().preview!;expect(old.baseText).toBe('录音期间输入');expect(f.controller.isBusy()).toBe(false);await draft(f.controller,'检查后输入');const rejected=f.service.append(old);expect(rejected.applied).toBe(false);await expect(rejected.saving).rejects.toBeDefined();expect(f.controller.pendingDocument().drafts.messages['question:column-a']).toBe('检查后输入');
  const latest=f.service.repreview();expect(latest.baseText).toBe('检查后输入');const result=f.service.append(latest);expect(result.applied).toBe(true);await result.saving;expect(f.controller.pendingDocument().drafts.messages['question:column-a']).toBe('检查后输入\n函数');
});
it('consumes an applied request once even when its durable save fails with quota',async()=>{
  const f=await fixture();await review(f);const preview=f.service.snapshot().preview!;vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(()=>{throw new DOMException('full','QuotaExceededError');});
  const applied=f.service.append(preview);expect(applied.applied).toBe(true);expect(f.controller.pendingDocument().drafts.messages['question:column-a']).toBe('原文\n函数可以接收参数');await expect(applied.saving).rejects.toBeDefined();
  const twice=f.service.append(preview);expect(twice.applied).toBe(false);await expect(twice.saving).rejects.toBeDefined();expect(f.controller.pendingDocument().drafts.messages['question:column-a']).toBe('原文\n函数可以接收参数');expect(f.service.snapshot().preview).toBeNull();
});
it('reuses one ready worker after an applied review while rejecting its retained previous callback',async()=>{
  const f=await fixture();const first=await review(f);const previous=first.worker.onmessage!;const applied=f.service.append(f.service.snapshot().preview!);await applied.saving;
  const second=await recognizing(f);expect(f.workers).toHaveLength(1);expect(second.requestId).toBeGreaterThan(first.requestId);expect(first.worker.messages.filter(message=>message.type==='init')).toHaveLength(1);
  previous({data:{type:'result',requestId:first.requestId,text:'迟到旧文字'}} as MessageEvent);expect(f.service.snapshot().phase).toBe('recognizing');
  first.worker.emit({type:'result',requestId:second.requestId,text:'返回结果'});expect(f.service.snapshot().preview?.transcript).toBe('返回结果');expect(f.controller.pendingDocument().drafts.messages['question:column-a']).toBe('原文\n函数可以接收参数');
});
it('terminates an idle worker after 60 seconds and does not keep the preview target alive after dispose',async()=>{
  const f=await fixture();const active=await review(f);f.clock.advance(59999);expect(active.worker.terminated).toBe(0);f.clock.advance(1);expect(active.worker.terminated).toBe(1);expect(f.service.snapshot().preview?.transcript).toBe('函数可以接收参数');
  f.service.dispose();expect(f.service.snapshot().preview).toBeNull();expect(f.service.start().accepted).toBe(false);expect(f.controller.isBusy()).toBe(false);
});
