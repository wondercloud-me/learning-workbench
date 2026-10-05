import {expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import resources from '../src/browser/voice/resources.json';
import {validateVoiceManifest,voiceManifestJson,type VoiceManifest} from '../src/browser/voice/manifest';
import {createVoiceModelStore,type VoiceCache,type VoiceCaches} from '../src/browser/voice/model-store';

const origin='https://workbench.test';const basePath='/learn/optional-asr/1.13.8/build-a/';
const crypto=webcrypto as unknown as Crypto;
const hex=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>)),b=>b.toString(16).padStart(2,'0')).join('');
const bytes=(text:string)=>new TextEncoder().encode(text);
const gate=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};};
function deployment():VoiceManifest{return {schemaVersion:1,buildId:'build-a',basePath,modelKind:'senseVoice',runtimeVersion:'1.13.8',files:[
 ...resources.files.map(f=>({role:f.role,filename:f.filename,url:basePath+f.filename,downloadUrl:basePath+f.filename+'?wb-asr-download=1',bytes:f.bytes,sha256:f.sha256})),
 {role:'worker',filename:'runtime.worker.js',url:basePath+'runtime.worker.js',downloadUrl:basePath+'runtime.worker.js?wb-asr-download=1',bytes:123,sha256:'a'.repeat(64)},
 {role:'worklet',filename:'capture.worklet.js',url:basePath+'capture.worklet.js',downloadUrl:basePath+'capture.worklet.js?wb-asr-download=1',bytes:45,sha256:'b'.repeat(64)},
] as VoiceManifest['files']};}
class MemoryCache implements VoiceCache {
 entries=new Map<string,Response>();
 beforePut?: (key:string)=>Promise<void>;
 async put(key:string,response:Response){await this.beforePut?.(key);this.entries.set(key,new Response(await response.arrayBuffer(),{headers:response.headers}));}
 async match(key:string){return this.entries.get(key)?.clone();}
}
class MemoryCaches implements VoiceCaches {
 caches=new Map<string,MemoryCache>();
 async open(name:string){let cache=this.caches.get(name);if(!cache){cache=new MemoryCache();this.caches.set(name,cache);}return cache;}
 async keys(){return [...this.caches.keys()];}
 async delete(name:string){return this.caches.delete(name);}
}
async function fixture(){
 const manifest=deployment();const contents=new Map<string,Uint8Array<ArrayBuffer>>();
 const files=await Promise.all(manifest.files.map(async(f,index)=>{const body=bytes(`file-${index}`);contents.set(f.url,body);return {...f,bytes:body.byteLength,sha256:await hex(body)};}));
 const small:VoiceManifest={...manifest,files};const caches=new MemoryCaches();let generation=0;
 const fetch=vi.fn(async(url:string,_init:RequestInit)=>new Response(contents.get(new URL(url,origin).pathname)));
 const ports={caches,fetch,crypto,origin,generationId:()=>`generation-${++generation}`};
 return {manifest:small,contents,caches,fetch,ports,store:createVoiceModelStore(small,ports)};
}

it('seals SenseVoice and the matching trio with distinct exact source and license metadata',()=>{
 const manifest=validateVoiceManifest(deployment(),'/learn/');
 expect(manifest.files.map(f=>[f.role,f.bytes])).toEqual([['glue',93039],['wasm',15133855],['wrapper',53867],['model',239233841],['tokens',315894],['worker',123],['worklet',45]]);
 expect(resources.model.revision).toBe('2365baeacb507f821a0c8120fcee3d484dba7a07');
 expect(resources.model.license.name).toBe('FunASR Model Open Source License Agreement 1.1');expect(resources.runtime.license.name).toBe('Apache-2.0');
 expect(resources.runtime.initialMemoryBytes).toBe(536870912);expect(resources.runtime.maximumMemoryBytes).toBe(2147483648);
 expect(resources.runtime.archive.sha256).toBe('e25a3813eb080636280b23dd4b0098252902675158b66dceda1efba061adf5d7');
 expect(voiceManifestJson(manifest)).toBe(JSON.stringify(deployment()));
});
it.each(['bytes','sha256','namespace','model-kind','runtime-version','main-url','foreign-url','path','missing','duplicate','query-key','generated-hash'])('rejects deployment manifest mutation %s',kind=>{
 expect(()=>validateVoiceManifest(deployment(),'/learn/')).not.toThrow();
 const d=deployment();const changed=structuredClone(d) as any;
 if(kind==='bytes')changed.files[3].bytes++;if(kind==='sha256')changed.files[0].sha256='f'.repeat(64);
 if(kind==='namespace')changed.basePath='/optional-asr/1.13.8/build-a/';if(kind==='model-kind')changed.modelKind='paraformer';
 if(kind==='runtime-version')changed.runtimeVersion='main';if(kind==='main-url')changed.files[3].downloadUrl=resources.files[3].source.replace(resources.model.revision,'main');
 if(kind==='foreign-url')changed.files[0].downloadUrl='https://other.test/runtime.js';if(kind==='path')changed.files[0].url='/learn/optional-asr/1.13.8/other/'+changed.files[0].filename;
 if(kind==='missing')changed.files.pop();if(kind==='duplicate')changed.files[6]=changed.files[5];if(kind==='query-key')changed.files[0].url+='?extra=1';
 if(kind==='generated-hash')changed.files[5].sha256='pending';
 expect(()=>validateVoiceManifest(changed,'/learn/')).toThrow();
});
it('accepts only the complete pinned HF model/tokens routes in a portable deployment',()=>{
 const d=deployment();const manifest=validateVoiceManifest({...d,files:d.files.map(f=>f.role==='model'||f.role==='tokens'?{...f,downloadUrl:resources.files.find(r=>r.role===f.role)!.source}:f)},'/learn/');
 expect(manifest.files[3].url).toBe(basePath+'model.int8.onnx');expect(manifest.files[3].downloadUrl).toContain('/resolve/'+resources.model.revision+'/');
});
it('accepts the worker-derived absolute app base but rejects ambiguous absolute base URLs',()=>{
 expect(validateVoiceManifest(deployment(),origin+'/learn/')).toEqual(validateVoiceManifest(deployment(),'/learn/'));
 for(const base of [origin+'/learn/?other=1',origin+'/learn/#hash','https://user:password@workbench.test/learn/','file:///learn/'])expect(()=>validateVoiceManifest(deployment(),base)).toThrow();
});
it('does no I/O before explicit download and reports actual streamed bytes before ready',async()=>{
 const {store,fetch,caches,contents}=await fixture();expect(fetch).not.toHaveBeenCalled();expect(await caches.keys()).toEqual([]);
 const progress:any[]=[];
 fetch.mockImplementation(async(url:string)=>{const body=contents.get(new URL(url,origin).pathname)!;return new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(body.slice(0,2));controller.enqueue(body.slice(2));controller.close();}}));});
 await store.download(value=>progress.push(value));
 expect(progress.map(p=>p.receivedBytes)).toEqual([2,6,8,12,14,18,20,24,26,30,32,36,38,42]);
 expect(progress[0]).toEqual({receivedBytes:2,totalBytes:42,currentFile:'sherpa-onnx-wasm-web.js',fileReceivedBytes:2,fileTotalBytes:6});
 expect(progress.every(p=>p.totalBytes===42)).toBe(true);expect(store.status()).toBe('ready');expect(fetch).toHaveBeenCalledTimes(7);
 const buffers=await store.load();expect(new Uint8Array(buffers.model)).toEqual(bytes('file-3'));
 expect(fetch.mock.calls.every(([,init])=>init?.credentials==='omit'&&init?.cache==='no-store'&&init?.mode==='cors')).toBe(true);
});
it('stores consumer-compatible MIME types by verified resource role independently of host headers',async()=>{
 const {store,fetch,caches,contents,manifest}=await fixture();
 fetch.mockImplementation(async(url:string)=>new Response(contents.get(new URL(url,origin).pathname),{headers:{'content-type':'application/json'}}));
 await store.download();const cache=caches.caches.get((await caches.keys())[0])!;
 const expected={glue:'application/javascript',wasm:'application/wasm',wrapper:'application/javascript',model:'application/octet-stream',tokens:'text/plain',worker:'application/javascript',worklet:'application/javascript'};
 for(const file of manifest.files){const response=await cache.match(origin+file.url);expect(response!.headers.get('content-type')?.split(';')[0]).toBe(expected[file.role]);}
});
it.each(['oversized','truncated','hash','opaque','http','cors','quota'])('does not publish ready for %s and preserves another cache namespace',async(kind)=>{
 const {store,fetch,caches}=await fixture();await caches.open('growth-workbench-shell-existing');
 if(kind==='quota')caches.open=async name=>{const cache=new MemoryCache();caches.caches.set(name,cache);cache.beforePut=async()=>{throw new DOMException('full','QuotaExceededError');};return cache;};
 else fetch.mockImplementationOnce(async()=>{
  if(kind==='cors')throw new TypeError('Failed to fetch');
  if(kind==='opaque'){const response=new Response();Object.defineProperty(response,'type',{value:'opaque'});return response;}
  if(kind==='http')return new Response('missing',{status:404});
  return new Response(kind==='oversized'?'too-large':kind==='truncated'?'short':'wrong!');
 });
 const code={oversized:'integrity',truncated:'integrity',hash:'integrity',opaque:'opaque',http:'http',cors:'network',quota:'quota'}[kind];
 await expect(store.download()).rejects.toMatchObject({code});expect(store.status()).toBe('missing');expect(await caches.keys()).toEqual(['growth-workbench-shell-existing']);
 await expect(store.load()).rejects.toMatchObject({code:'missing'});
});
it('cancels the underlying download reader when cache put fails before consuming it',async()=>{
 const {store,fetch,caches}=await fixture();const cancel=vi.fn();
 fetch.mockImplementationOnce(async()=>new Response(new ReadableStream<Uint8Array>({cancel})));
 caches.open=async name=>{const cache=new MemoryCache();caches.caches.set(name,cache);cache.beforePut=async()=>{throw new DOMException('full','QuotaExceededError');};return cache;};
 await expect(store.download()).rejects.toMatchObject({code:'quota'});expect(cancel).toHaveBeenCalledOnce();
});
it('keeps the old ready cache when a replacement staging download fails',async()=>{
 const {store,fetch,caches}=await fixture();await store.download();const previous=await caches.keys();
 fetch.mockImplementationOnce(async()=>new Response('wrong!'));await expect(store.download()).rejects.toMatchObject({code:'integrity'});
 expect(await caches.keys()).toEqual(previous);expect(new Uint8Array((await store.load()).model)).toEqual(bytes('file-3'));
});
it('aborts a pending fetch and refuses its late response and progress',async()=>{
 const {store,fetch,caches}=await fixture();const pending=gate();const signals:AbortSignal[]=[];const progress=vi.fn();
 fetch.mockImplementationOnce(async(_url,init)=>{signals.push(init!.signal!);await pending.promise;return new Response('file-0');});
 const download=store.download(progress);const rejected=expect(download).rejects.toMatchObject({code:'cancelled'});
 await vi.waitFor(()=>expect(fetch).toHaveBeenCalledOnce());await store.cancel();expect(signals[0].aborted).toBe(true);pending.resolve();await rejected;
 expect(progress).not.toHaveBeenCalled();expect(await caches.keys()).toEqual([]);
});
it.each(['cancel','delete'] as const)('detaches a delayed old ready-marker put on %s before a new generation',async(action)=>{
 const {store,caches}=await fixture();const pending=gate();let waiting=false;const open=caches.open.bind(caches);
 caches.open=async name=>{const cache=await open(name);cache.beforePut=async key=>{if(key.endsWith('/ready.json')&&!waiting){waiting=true;await pending.promise;}};return cache;};
 const old=store.download();const rejected=expect(old).rejects.toMatchObject({code:'cancelled'});await vi.waitFor(()=>expect(waiting).toBe(true));
 await store[action]();await store.download();const current=await caches.keys();expect(current).toHaveLength(1);
 pending.resolve();await rejected;expect(await caches.keys()).toEqual(current);expect(new Uint8Array((await store.load()).model)).toEqual(bytes('file-3'));
});
it('rechecks cache bytes and WebCrypto hash on each fresh worker load without fetching',async()=>{
 const {store,caches,fetch,manifest,ports}=await fixture();await store.download();fetch.mockClear();
 const fresh=createVoiceModelStore(manifest,ports);expect(new Uint8Array((await fresh.load()).tokens)).toEqual(bytes('file-4'));
 const cache=caches.caches.get((await caches.keys())[0])!;await cache.put(origin+basePath+'model.int8.onnx',new Response('wrong!'));
 await expect(fresh.load()).rejects.toMatchObject({code:'integrity'});expect(fresh.status()).toBe('missing');expect(fetch).not.toHaveBeenCalled();
});
it('reports missing cached files offline and deletes only optional ASR data',async()=>{
 const {store,caches,fetch}=await fixture();await store.download();await caches.open('growth-workbench-shell-existing');
 const cache=caches.caches.get((await caches.keys())[0])!;cache.entries.delete(origin+basePath+'tokens.txt');fetch.mockClear();
 await expect(store.load()).rejects.toMatchObject({code:'missing'});expect(fetch).not.toHaveBeenCalled();await store.delete();
 expect(await caches.keys()).toEqual(['growth-workbench-shell-existing']);expect(store.status()).toBe('missing');
});
it('rejects overlapping downloads and makes active cached reads stale on delete',async()=>{
 const {store,caches,fetch}=await fixture();const pending=gate();fetch.mockImplementationOnce(async()=>{await pending.promise;return new Response('file-0');});
 const first=store.download();const rejection=expect(first).rejects.toMatchObject({code:'cancelled'});await vi.waitFor(()=>expect(fetch).toHaveBeenCalledOnce());
 await expect(store.download()).rejects.toMatchObject({code:'busy'});await store.cancel();pending.resolve();await rejection;
 await store.download();const cache=caches.caches.get((await caches.keys())[0])!;const match=cache.match.bind(cache);const read=gate();let waiting=false;
 cache.match=async key=>{const response=await match(key);if(key.endsWith('/model.int8.onnx')){waiting=true;await read.promise;}return response;};
 const loading=store.load();const rejected=expect(loading).rejects.toMatchObject({code:'cancelled'});await vi.waitFor(()=>expect(waiting).toBe(true));await store.delete();read.resolve();await rejected;
});
