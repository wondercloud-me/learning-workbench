import {afterEach, describe, expect, it} from 'vitest';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import vm from 'node:vm';

const origin='https://workbench.test', base='/learn/', buildId='body-consumption';
const cacheName='growth-workbench-shell-%2Flearn%2F-'+buildId;
const markerUrl=origin+base+'__wb_cache_build__';
const folders:string[]=[];
afterEach(async()=>{await Promise.all(folders.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
type Resource={bytes:Uint8Array<ArrayBuffer>;status:number;statusText:string;contentType:string};

async function shellFixture(){
 const outDir=await mkdtemp(join(tmpdir(),'workbench-shell-install-'));folders.push(outDir);
 await mkdir(join(outDir,'assets'));
 const names=['index.html','manifest.webmanifest','assets/lab.worker-a.js','assets/quickjs-a.wasm',...Array.from({length:59},(_,i)=>'assets/shell-'+i+'.js')];
 for(const name of names){
  const bytes=name==='manifest.webmanifest'?JSON.stringify({icons:[]}):name.endsWith('.wasm')?new Uint8Array([0,97,115,109,255,0]):'fixture '+name+' 中文';
  await writeFile(join(outDir,name),bytes);
 }
 const generator=await import(resolve('scripts/build-browser-sw.mjs'));
 await generator.generateBrowserServiceWorker({outDir,base,buildId});
 const resources=new Map<string,Resource>();
 for(const [i,name] of names.sort().entries())resources.set(origin+base+name,{
  bytes:new Uint8Array(await readFile(join(outDir,name))),status:i%2?201:200,statusText:i%2?'Fixture Created':'Fixture OK',
  contentType:name.endsWith('.wasm')?'application/wasm':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.webmanifest')?'application/manifest+json':'application/javascript'
 });
 return {resources,code:await readFile(join(outDir,'sw.js'),'utf8')};
}

// This is a bounded transport risk model, not evidence about Chromium's pool.
// A real ReadableStream with HWM 0 holds a slot until its body is consumed.
function bodyLimitedTransport(resources:Map<string,Resource>,capacity:number,failedBody?:string){
 let active=0,started=0,consumed=0,peak=0,disposed=false;
 const waiting:Array<{start:()=>void;reject:(error:Error)=>void}>=[];
 const streams=new Set<ReadableStreamDefaultController<Uint8Array>>();
 function drain(){while(!disposed&&active<capacity&&waiting.length)waiting.shift()!.start();}
 const fetch=(request:Request)=>new Promise<Response>((resolve,reject)=>{
  const resource=resources.get(request.url);
  if(!resource){reject(Error('Unexpected shell URL: '+request.url));return;}
  if(disposed){reject(Error('Transport disposed'));return;}
  const start=()=>{
   active++;started++;peak=Math.max(peak,active);
   let released=false;
   const release=()=>{if(released)return;released=true;active--;drain();};
   const stream=new ReadableStream<Uint8Array>({
    start(controller){streams.add(controller);},
    pull(controller){
     streams.delete(controller);
     if(request.url===failedBody){controller.error(Error('Shell body read failed'));release();return;}
     controller.enqueue(resource.bytes);controller.close();consumed++;release();
    },
    cancel(){release();}
   },{highWaterMark:0});
   resolve(new Response(stream,{status:resource.status,statusText:resource.statusText,headers:{'Content-Type':resource.contentType,'X-Shell-Fixture':'retained'}}));
  };
  if(active<capacity)start();else waiting.push({start,reject});
 });
 return {fetch,snapshot:()=>({active,started,consumed,peak,queued:waiting.length}),dispose:()=>{
  disposed=true;
  for(const pending of waiting.splice(0))pending.reject(Error('Transport disposed'));
  for(const controller of streams)controller.error(Error('Transport disposed'));
  streams.clear();
 }};
}

function installWorker(code:string,transport:ReturnType<typeof bodyLimitedTransport>){
 const stores=new Map<string,Map<string,Response>>([['previous-shell',new Map([['old-shell',new Response('previous bytes',{headers:{'Content-Type':'text/html'}})]])]]);
 const opened:string[]=[],puts:string[]=[],handlers=new Map<string,(event:{waitUntil:(promise:Promise<void>)=>void})=>void>();
 const caches={delete:async(name:string)=>stores.delete(name),open:async(name:string)=>{
  opened.push(name);if(!stores.has(name))stores.set(name,new Map());const store=stores.get(name)!;
  return {put:async(url:string,response:Response)=>{
   const bytes=await response.arrayBuffer();
   store.set(url,new Response(bytes,{status:response.status,statusText:response.statusText,headers:response.headers}));puts.push(url);
  }};
 }};
 const self={location:new URL(origin+base+'sw.js'),addEventListener:(name:string,handler:(event:{waitUntil:(promise:Promise<void>)=>void})=>void)=>handlers.set(name,handler)};
 vm.runInNewContext(code,{self,caches,fetch:transport.fetch,URL,Request,Response,Set,Map,Promise,crypto:globalThis.crypto,setTimeout,clearTimeout});
 let pending:Promise<void>|undefined;
 handlers.get('install')!({waitUntil:promise=>{pending=promise;}});
 if(!pending)throw Error('Generated worker did not register installation');
 return {pending,stores,opened,puts};
}

async function completionWithin(pending:Promise<void>){
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([
  pending.then(()=> 'completed' as const),
  new Promise<'pending'>(resolve=>{timer=setTimeout(()=>resolve('pending'),250);})
 ]);}finally{if(timer)clearTimeout(timer);}
}

describe('generated shell installation body consumption',()=>{
 it('completes a 63-resource install when only three unconsumed bodies can occupy transport slots',async()=>{
  const fixture=await shellFixture(),transport=bodyLimitedTransport(fixture.resources,3);
  const worker=installWorker(fixture.code,transport);
  try{
   expect(await completionWithin(worker.pending),JSON.stringify(transport.snapshot())).toBe('completed');
   expect(worker.stores.get(cacheName)?.size).toBe(64);
   expect(await worker.stores.get(cacheName)!.get(markerUrl)!.json()).toMatchObject({buildId,base,complete:true});
   expect(worker.puts.at(-1)).toBe(markerUrl);
   for(const [url,resource] of fixture.resources){
    const cached=worker.stores.get(cacheName)!.get(url)!;
    expect(new Uint8Array(await cached.arrayBuffer())).toEqual(resource.bytes);
    expect(cached.status).toBe(resource.status);expect(cached.statusText).toBe(resource.statusText);
    expect(cached.headers.get('Content-Type')).toBe(resource.contentType);
    expect(cached.headers.get('X-Shell-Fixture')).toBe('retained');
   }
  }finally{transport.dispose();await worker.pending.catch(()=>{});}
 });

 it('does not commit an incomplete body or a ready marker and preserves the previous shell on body read failure',async()=>{
  const fixture=await shellFixture(),transport=bodyLimitedTransport(fixture.resources,Infinity,origin+base+'assets/quickjs-a.wasm');
  const worker=installWorker(fixture.code,transport);
  try{
   await expect(worker.pending).rejects.toThrow('Shell body read failed');
   expect(worker.opened).toEqual([]);expect(worker.puts).toEqual([]);
   expect([...worker.stores.keys()]).toEqual(['previous-shell']);
   const old=worker.stores.get('previous-shell')!.get('old-shell')!;
   expect(await old.text()).toBe('previous bytes');expect(old.headers.get('Content-Type')).toBe('text/html');
   expect(worker.stores.get(cacheName)?.has(markerUrl)??false).toBe(false);
  }finally{transport.dispose();}
 });

 it('rejects a response from another origin before consuming its failing body',async()=>{
  const fixture=await shellFixture(),foreign=origin+base+'assets/quickjs-a.wasm';
  const transport=bodyLimitedTransport(fixture.resources,Infinity,foreign),fetch=transport.fetch;
  transport.fetch=async request=>{
   const response=await fetch(request);
   if(request.url===foreign)Object.defineProperty(response,'url',{value:'https://external.test/untrusted.wasm'});
   return response;
  };
  const worker=installWorker(fixture.code,transport);
  try{
   await expect(worker.pending).rejects.toThrow('Required offline asset unavailable: /learn/assets/quickjs-a.wasm');
   expect(worker.opened).toEqual([]);expect(worker.puts).toEqual([]);
   expect([...worker.stores.keys()]).toEqual(['previous-shell']);
  }finally{transport.dispose();}
 });
});
