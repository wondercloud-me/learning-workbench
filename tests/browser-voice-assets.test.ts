import {afterEach, describe, expect, it} from 'vitest';
import {cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';

const folders:string[]=[];
afterEach(async()=>{await Promise.all(folders.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
const base='/learning-workbench/learn/',buildId='fixture-build';
const generatorPath=resolve('scripts/build-browser-sw.mjs'),preparePath=resolve('scripts/prepare-browser-asr.mjs');
const modelUrl='https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/model.int8.onnx';
async function shell(){
 const root=await mkdtemp(join(tmpdir(),'browser-voice-assets-'));folders.push(root);const outDir=join(root,'dist-browser');
 await mkdir(join(outDir,'assets'),{recursive:true});
 for(const [name,text] of Object.entries({'index.html':'shell','assets/lab.worker-test.js':'lab','assets/quickjs-test.wasm':'wasm','manifest.webmanifest':'{}','browser-build.json':JSON.stringify({base,buildId})}))await writeFile(join(outDir,name),text);
 return {root,outDir};
}
async function preparable(){
 const f=await shell();await writeFile(join(f.outDir,'browser-build.json'),JSON.stringify({base,buildId,optionalAsrEnabled:true}));await writeFile(join(f.outDir,'sw.js'),'original shell worker');
 const sources=join(f.root,'src/browser/voice');await mkdir(sources,{recursive:true});
 await writeFile(join(sources,'runtime.worker.ts'),"postMessage('fixture-only');");await writeFile(join(sources,'capture.worklet.ts'),"registerProcessor('fixture-only',class {});");
 await mkdir(join(f.outDir,'licenses'));
 for(const name of ['sherpa-onnx-LICENSE.txt','SenseVoice-MODEL-LICENSE.txt'])await cp(resolve('licenses',name),join(f.outDir,'licenses',name));
 return f;
}
function worker(code:string,stores=new Map<string,Map<string,Response>>()){
 const handlers=new Map<string,Function>(),fetched:string[]=[];
 const self={location:new URL('https://workbench.test'+base+'sw.js'),addEventListener:(name:string,fn:Function)=>handlers.set(name,fn)};
 vm.runInNewContext(code,{self,URL,Request,Response,Map,Set,Promise,crypto:globalThis.crypto,fetch:async(r:Request)=>{fetched.push(r.url);return new Response('shell');},caches:{keys:async()=>[...stores.keys()],delete:async(key:string)=>stores.delete(key),open:async(key:string)=>{if(!stores.has(key))stores.set(key,new Map());const rows=stores.get(key)!;return {put:async(url:string,response:Response)=>{rows.set(url,response.clone());},match:async(url:string)=>rows.get(url)?.clone()};}}});
 async function install(){let pending:Promise<unknown>|undefined;handlers.get('install')!({waitUntil:(p:Promise<unknown>)=>pending=p});await pending;}
 async function request(url:string,headers?:HeadersInit){let response:Promise<Response>|undefined;handlers.get('fetch')!({request:new Request(url,{headers}),respondWith:(p:Promise<Response>)=>response=p});return response?await response:undefined;}
 return {install,fetched,request};
}
async function deployment(){
 const resources=JSON.parse(await readFile('src/browser/voice/resources.json','utf8'));
 const basePath=base+'optional-asr/1.13.8/'+buildId+'/';
 const files=resources.files.map((f:any)=>({role:f.role,filename:f.filename,url:basePath+f.filename,downloadUrl:['model','tokens'].includes(f.role)?f.source:basePath+f.filename+'?wb-asr-download=1',bytes:f.bytes,sha256:f.sha256}));
 for(const [role,filename] of [['worker','runtime.worker.js'],['worklet','capture.worklet.js']])files.push({role,filename,url:basePath+filename,downloadUrl:basePath+filename+'?wb-asr-download=1',bytes:7,sha256:createHash('sha256').update('fixture').digest('hex')});
 return {schemaVersion:1,buildId,basePath,modelKind:'senseVoice',runtimeVersion:'1.13.8',files};
}
describe('optional browser voice assets',()=>{
 it.each([['manifest.webmanifest','ENOSPC'],['sw.js','EIO']] as const)('preserves the completed shell and rejects the new optional directory after partial %s write failure (%s)',async(target,code)=>{
  const {root,outDir}=await shell(),manifest=await deployment();
  const originalManifest='{"name":"completed shell","scope":"/previous/"}\n',originalWorker='completed shell worker\n';
  await writeFile(join(outDir,'manifest.webmanifest'),originalManifest);await writeFile(join(outDir,'sw.js'),originalWorker);
  await writeFile(join(outDir,'.unowned.tmp'),'unrelated temporary file');
  const staging=join(root,'verified-staging');await mkdir(staging);
  // This fixture exercises publication only, after archive/resource verification.
  await writeFile(join(staging,'runtime.worker.js'),'fixture');await writeFile(join(staging,'resources.json'),JSON.stringify(manifest));
  const retained=join(outDir,'optional-asr/1.13.8/retained-build');await mkdir(retained,{recursive:true});await writeFile(join(retained,'resources.json'),'retained optional build');
  const fault=join(root,'write-fault.mjs'),runner=join(root,'publish.mjs'),log=join(root,'write-fault.json');
  await writeFile(fault,`import fs from 'node:fs';
import {basename} from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
const originalWrite=fs.promises.writeFile,originalOpen=fs.promises.open;
const target=${JSON.stringify(target)},log=${JSON.stringify(log)},code=${JSON.stringify(code)};
const matches=p=>typeof p==='string'&&(basename(p)===target||basename(p).startsWith('.'+target+'.'));
async function fail(path,data,options,write){
 await write(String(data).slice(0,17),options);
 await originalWrite(log,JSON.stringify({path,partialBytes:17,code}));
 throw Object.assign(Error('injected partial write failure'),{code});
}
fs.promises.writeFile=async(path,data,options)=>matches(path)?fail(path,data,options,(part,opts)=>originalWrite(path,part,opts)):originalWrite(path,data,options);
fs.promises.open=async(path,...args)=>{
 const handle=await originalOpen(path,...args);
 if(matches(path)){const write=handle.writeFile.bind(handle);handle.writeFile=(data,options)=>fail(path,data,options,write);}
 return handle;
};
syncBuiltinESMExports();
`);
  await writeFile(runner,`import {publishPreparedBrowserAsr} from ${JSON.stringify(preparePath)};
await publishPreparedBrowserAsr(${JSON.stringify({staging,outDir,base,buildId,manifest})});\n`);
  const result=spawnSync(process.execPath,['--import',fault,runner],{encoding:'utf8'});
  expect(result.status).not.toBe(0);expect(result.stderr).toContain('injected partial write failure');
  const injected=JSON.parse(await readFile(log,'utf8'));expect(injected.partialBytes).toBe(17);expect(injected.code).toBe(code);
  await expect(readdir(join(outDir,'optional-asr/1.13.8',buildId))).rejects.toMatchObject({code:'ENOENT'});
  expect(await readFile(join(retained,'resources.json'),'utf8')).toBe('retained optional build');
  expect(await readFile(join(outDir,'manifest.webmanifest'),'utf8')).toBe(originalManifest);
  expect(await readFile(join(outDir,'sw.js'),'utf8')).toBe(originalWorker);
  expect((await readdir(outDir)).filter(name=>name.endsWith('.tmp'))).toEqual(['.unowned.tmp']);
  expect(await readFile(join(outDir,'.unowned.tmp'),'utf8')).toBe('unrelated temporary file');
 });
 it('rejects an altered local runtime archive without emitting an optional artifact',async()=>{
  const {root,outDir}=await preparable(),prepare=await import(preparePath),archivePath=join(root,'bad-runtime.tar.gz');await writeFile(archivePath,'not the pinned archive');
  await expect(prepare.prepareBrowserAsr({sourceDir:root,enabled:true,modelUrl,archivePath})).rejects.toThrow('checksum mismatch');
  expect(await readFile(join(outDir,'sw.js'),'utf8')).toBe('original shell worker');await expect(readdir(join(outDir,'optional-asr'))).rejects.toMatchObject({code:'ENOENT'});
 });
 it.each(['sherpa-onnx-LICENSE.txt','SenseVoice-MODEL-LICENSE.txt'])('requires unchanged independent notice %s before preparing resources',async(name)=>{
  const {root,outDir}=await preparable(),prepare=await import(preparePath);await writeFile(join(outDir,'licenses',name),'wrong license');
  const archivePath=join(root,'unused-archive.tar.gz');await writeFile(archivePath,'fixture');
  await expect(prepare.prepareBrowserAsr({sourceDir:root,enabled:true,modelUrl,archivePath})).rejects.toThrow('notice');
  await expect(readdir(join(outDir,'optional-asr'))).rejects.toMatchObject({code:'ENOENT'});
 });
 it('excludes the entire optional namespace including its manifest from shell install fetches',async()=>{
  const {outDir}=await shell();const optional=join(outDir,'optional-asr/1.13.8',buildId);await mkdir(optional,{recursive:true});
  for(const name of ['resources.json','runtime.worker.js','capture.worklet.js','sherpa-onnx-wasm-web.wasm','model.int8.onnx'])await writeFile(join(optional,name),'optional fixture');
  const generator=await import(generatorPath);await generator.generateBrowserServiceWorker({outDir,base,buildId});
  const sw=worker(await readFile(join(outDir,'sw.js'),'utf8'));await sw.install();
  expect(sw.fetched.some(url=>url.includes('/optional-asr/'))).toBe(false);
  expect(sw.fetched).toContain('https://workbench.test'+base+'assets/quickjs-test.wasm');
  expect(sw.fetched).toContain('https://workbench.test'+base+'assets/lab.worker-test.js');
  expect(sw.fetched.some(url=>url.endsWith('.tmp'))).toBe(false);
 });
 it.each(['ready','missing','wrong-digest','wrong-paths','wrong-cache','staging','old-shell'] as const)('serves an exact runtime URL only from matching verified ready cache (%s)',async(kind)=>{
  const {outDir}=await shell(),manifest=await deployment(),generator=await import(generatorPath);
  await generator.generateBrowserServiceWorker({outDir,base,buildId,optionalManifest:manifest});
  const digest=createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),key='growth-workbench-optional-asr-v1:'+digest+':generation-a',origin='https://workbench.test';
  const cacheKey=kind==='staging'?'growth-workbench-optional-asr-v1:staging:fixture':kind==='old-shell'?'growth-workbench-shell-old':key;
  const urls=manifest.files.map((f:any)=>origin+f.url),rows=new Map<string,Response>([[urls[0],new Response('verified runtime')]]);
  if(kind!=='missing')rows.set(origin+manifest.basePath+'ready.json',new Response(JSON.stringify({schemaVersion:1,manifestDigest:kind==='wrong-digest'?'0'.repeat(64):digest,cacheName:kind==='wrong-cache'?'other':cacheKey,resourceUrls:kind==='wrong-paths'?[]:urls})));
  const sw=worker(await readFile(join(outDir,'sw.js'),'utf8'),new Map([[cacheKey,rows]]));
  const response=await sw.request(urls[0]);expect(response?.status).toBe(kind==='ready'?200:503);
  if(kind==='ready')expect(await response!.text()).toBe('verified runtime');
  expect(sw.fetched).toEqual([]);
 });
 it('leaves model, tokens, manifest, arbitrary paths, query, API and authorization requests untouched',async()=>{
  const {outDir}=await shell(),manifest=await deployment(),generator=await import(generatorPath);
  await generator.generateBrowserServiceWorker({outDir,base,buildId,optionalManifest:manifest});
  const sw=worker(await readFile(join(outDir,'sw.js'),'utf8')),origin='https://workbench.test';
  for(const path of [manifest.files[3].url,manifest.files[4].url,manifest.basePath+'resources.json',manifest.basePath+'arbitrary.js',manifest.basePath+'../old/runtime.worker.js',manifest.files[0].downloadUrl,base+'api/model'])expect(await sw.request(origin+path)).toBeUndefined();
  expect(await sw.request(origin+manifest.files[0].url,{Authorization:'fixture'})).toBeUndefined();
  expect(await sw.request('https://external.test'+manifest.files[0].url)).toBeUndefined();
 });
 it.each([
  ['disabled',{},false,'explicitly enabled'],
  ['missing-shell',{WORKBENCH_BROWSER_ASR:'1'},false,'completed browser shell build'],
  ['missing-model-url',{WORKBENCH_BROWSER_ASR:'1'},true,'recorded model delivery URL'],
  ['missing-task3',{WORKBENCH_BROWSER_ASR:'1',WORKBENCH_BROWSER_ASR_MODEL_URL:'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/model.int8.onnx'},true,'Task 3 Worker/AudioWorklet'],
 ] as const)('fails closed before preparation for %s',async(_name,env,built,message)=>{
  const {root,outDir}=await shell();if(!built)await rm(outDir,{recursive:true});
  const result=spawnSync(process.execPath,[preparePath],{cwd:root,encoding:'utf8',env:{...process.env,WORKBENCH_BROWSER_ASR:'',WORKBENCH_BROWSER_ASR_MODEL_URL:'',...env}});
  expect(result.status).not.toBe(0);expect(result.stderr).toContain(message);
  await expect(readFile(join(root,'.cache/browser-local-voice/resources.json'))).rejects.toMatchObject({code:'ENOENT'});
  await expect(readFile(join(outDir,'optional-asr/1.13.8',buildId,'runtime.worker.js'))).rejects.toMatchObject({code:'ENOENT'});
 });
});
