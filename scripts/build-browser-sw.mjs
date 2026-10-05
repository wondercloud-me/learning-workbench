import {cp, open, readdir, readFile, rename, rm, stat} from 'node:fs/promises';
import {resolve, join, relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';

export function validateBrowserBase(base) {
 if(typeof base!=='string'||!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base))throw new Error('WORKBENCH_BROWSER_BASE must be an absolute local path starting and ending with /');
 return base;
}
async function filesIn(directory) {
 const entries=await readdir(directory,{withFileTypes:true});
 return (await Promise.all(entries.map(e=>e.isDirectory()?filesIn(join(directory,e.name)):e.isFile()?[join(directory,e.name)]:[]))).flat();
}
export async function copyBrowserNotices({sourceDir,outDir}) {
 const names=['LICENSE','THIRD_PARTY_NOTICES.md','licenses'];
 for(const name of names){
  let source;
  try{source=await stat(join(sourceDir,name));}catch(error){
   if(error.code==='ENOENT')throw new Error('Required browser notice source missing: '+name,{cause:error});
   throw error;
  }
  if(name==='licenses'?!source.isDirectory():!source.isFile())throw new Error('Invalid browser notice source: '+name);
 }
 for(const name of names)await cp(join(sourceDir,name),join(outDir,name),{recursive:true});
}
async function optionalRules(manifest,base,buildId){
 if(!manifest)return null;
 const metadata=JSON.parse(await readFile(new URL('../src/browser/voice/resources.json',import.meta.url),'utf8'));
 const basePath=base+metadata.pathPrefix+metadata.runtime.version+'/'+buildId+'/';
 if(manifest.schemaVersion!==1||manifest.buildId!==buildId||manifest.basePath!==basePath||manifest.modelKind!==metadata.model.kind||manifest.runtimeVersion!==metadata.runtime.version||!Array.isArray(manifest.files)||manifest.files.length!==7)throw Error('Invalid optional ASR deployment manifest');
 const expected=[...metadata.files,{role:'worker',filename:'runtime.worker.js'},{role:'worklet',filename:'capture.worklet.js'}];
 const files=manifest.files.map((file,i)=>{
  const pinned=expected[i],url=basePath+pinned.filename;
  if(file.role!==pinned.role||file.filename!==pinned.filename||file.url!==url||!Number.isSafeInteger(file.bytes)||file.bytes<=0||!/^[a-f0-9]{64}$/.test(file.sha256)||
   (pinned.sha256&&(file.sha256!==pinned.sha256||file.bytes!==pinned.bytes))||
   (file.downloadUrl!==url+'?wb-asr-download=1'&&(!['model','tokens'].includes(file.role)||file.downloadUrl!==pinned.source)))throw Error('Invalid optional ASR resource: '+pinned.role);
  return {role:file.role,filename:file.filename,url,downloadUrl:file.downloadUrl,bytes:file.bytes,sha256:file.sha256};
 });
 const canonical={schemaVersion:1,buildId,basePath,modelKind:metadata.model.kind,runtimeVersion:metadata.runtime.version,files};
 const digest=createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
 return {digest,cachePrefix:metadata.namespace+':'+digest+':',markerPath:basePath+'ready.json',resourcePaths:files.map(f=>f.url),paths:files.filter(f=>['glue','wasm','wrapper','worker','worklet'].includes(f.role)).map(f=>f.url)};
}
async function replaceBuildFiles(outDir,outputs){
 const staged=[];
 try{
  // Finish and close every write before replacing either completed shell file.
  for(const [filename,content] of outputs){
   const temporary=join(outDir,'.'+filename+'.'+randomUUID()+'.tmp');
   const handle=await open(temporary,'wx');
   staged.push({temporary,destination:join(outDir,filename)});
   try{await handle.writeFile(content);}finally{await handle.close();}
  }
  for(const file of staged)await rename(file.temporary,file.destination);
 }finally{await Promise.all(staged.map(file=>rm(file.temporary,{force:true})));}
}
export async function generateBrowserServiceWorker({outDir,base,buildId,optionalManifest}) {
 validateBrowserBase(base);
 if(typeof buildId!=='string'||!buildId||!/^[a-zA-Z0-9_-]+$/.test(buildId))throw new Error('Invalid browser build ID');
 const optional=await optionalRules(optionalManifest,base,buildId);
 const manifestPath=join(outDir,'manifest.webmanifest');
 const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
 Object.assign(manifest,{id:base,start_url:base,scope:base});
 const files=(await filesIn(outDir)).map(f=>relative(outDir,f).replaceAll('\\','/')).filter(f=>f!=='sw.js'&&!f.startsWith('optional-asr/')).sort();
 if(!files.includes('index.html')||!files.some(f=>f.endsWith('.wasm'))||!files.some(f=>/lab\.worker[-.].*\.js$/.test(f)))throw new Error('Browser build must include index.html, local WASM and lab.worker');
 if(files.some(f=>f.includes('..')||f.includes('?')||f.includes('#')||f.startsWith('/')))throw new Error('Unsafe output asset path');
 await replaceBuildFiles(outDir,[['manifest.webmanifest',JSON.stringify(manifest,null,2)+'\n'],['sw.js',renderWorker({base,buildId,files,optional})]]);
}
function renderWorker({base,buildId,files,optional}) {
 return String.raw`/* Generated from this browser build. Never cache user or API data. */
const BASE=${JSON.stringify(base)}, BUILD=${JSON.stringify(buildId)};
const PREFIX='growth-workbench-shell-'+encodeURIComponent(BASE)+'-';
const CACHE=PREFIX+BUILD;
const ASSETS=${JSON.stringify(files.map(f=>base+f))};
const ORIGIN=self.location.origin;
const URLS=new Set(ASSETS.map(p=>ORIGIN+p));
const SHELL=ORIGIN+BASE+'index.html';
const META=ORIGIN+BASE+'__wb_cache_build__';
const OPTIONAL=${JSON.stringify(optional)};
const rounds=new Map();
let updating=false,transaction;
const notify=(clients,type,updateId)=>{for(const client of clients)client.postMessage({type,updateId,buildId:BUILD});};
const scopedClients=async()=> (await self.clients.matchAll({type:'window',includeUncontrolled:true})).filter(c=>c.url.startsWith(ORIGIN+BASE));
self.addEventListener('install',event=>event.waitUntil((async()=>{
 try {
  // Fetch and consume every required resource before committing this version.
  const responses=await Promise.all(ASSETS.map(async p=>{
   const url=ORIGIN+p, response=await fetch(new Request(url,{cache:'reload',credentials:'omit',redirect:'error'}));
   if(!response.ok||response.type==='opaque'||(response.url&&new URL(response.url).origin!==ORIGIN))throw Error('Required offline asset unavailable: '+p);
   const cached=response.clone();await response.blob();
   return [url,cached];
  }));
  const cache=await caches.open(CACHE);
  await Promise.all(responses.map(([url,response])=>cache.put(url,response)));
  await cache.put(META,new Response(JSON.stringify({buildId:BUILD,base:BASE,complete:true,assets:ASSETS}),{headers:{'Content-Type':'application/json'}}));
 }catch(error){await caches.delete(CACHE);throw error;}
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 notify(await scopedClients(),'WB_ACTIVATED_UPDATE',transaction?.id);
 // Conservatively retain older builds while any scoped page remains open.
 if((await scopedClients()).length===0)for(const key of await caches.keys())if(key.startsWith(PREFIX)&&key!==CACHE)await caches.delete(key);
})()));
self.addEventListener('fetch',event=>{
 const r=event.request,u=new URL(r.url);
 // Let the browser expose real network failures for external, credentialed and API traffic.
 if(r.method!=='GET'||u.origin!==ORIGIN||r.headers.has('Authorization')||u.search||u.pathname.includes('/api/')||!u.pathname.startsWith(BASE))return;
 if(OPTIONAL?.paths.includes(u.pathname)){
  event.respondWith((async()=>{
   const expected=OPTIONAL.resourcePaths.map(path=>ORIGIN+path);
   for(const key of (await caches.keys()).reverse()){
    if(!key.startsWith(OPTIONAL.cachePrefix))continue;
    const cache=await caches.open(key),record=await cache.match(ORIGIN+OPTIONAL.markerPath);
    if(!record)continue;
    try{
     const marker=await record.json();
     if(marker.schemaVersion!==1||marker.manifestDigest!==OPTIONAL.digest||marker.cacheName!==key||!Array.isArray(marker.resourceUrls)||marker.resourceUrls.length!==expected.length||expected.some((url,i)=>marker.resourceUrls[i]!==url))continue;
     const response=await cache.match(u.href);if(response)return response;
    }catch{continue;}
   }
   return new Response('Verified optional ASR resource unavailable; explicitly download again.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  })());return;
 }
 const navigation=r.mode==='navigate';
 if(navigation&&!([BASE,BASE+'index.html'].includes(u.pathname)))return;
 if(!navigation&&!URLS.has(u.href)){
  // Only immutable, hashed build assets may be found in a retained older cache.
  if(!/^assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(u.pathname.slice(BASE.length)))return;
  event.respondWith((async()=>{
   for(const key of await caches.keys())if(key.startsWith(PREFIX)){
    const cache=await caches.open(key),metadata=await cache.match(META);
    if(!metadata)continue;
    const assets=(await metadata.json()).assets;
    if(assets.includes(u.pathname)){const response=await cache.match(u.href);if(response)return response;}
   }
   return fetch(r);
  })());return;
 }
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE),response=await cache.match(navigation?SHELL:u.href);
  // Never replace a missing version resource with a network response from another build.
  return response||new Response('Offline resource unavailable; reconnect and reload.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
 })());
});
async function isBuildReady(buildId){
 if(typeof buildId!=='string'||!/^[A-Za-z0-9_-]+$/.test(buildId))return false;
 const key=PREFIX+buildId;if(!(await caches.keys()).includes(key))return false;
 const cache=await caches.open(key),record=await cache.match(META);if(!record)return false;
 try{
  const meta=await record.json();
  if(meta.complete!==true||meta.base!==BASE||meta.buildId!==buildId||!Array.isArray(meta.assets)||!meta.assets.length)return false;
  if(buildId===BUILD&&(meta.assets.length!==ASSETS.length||ASSETS.some(p=>!meta.assets.includes(p))))return false;
  if(meta.assets.some(p=>typeof p!=='string'||!p.startsWith(BASE)||p.includes('..')||p.includes('?')||p.includes('#')))return false;
  for(const path of meta.assets)if(!(await cache.match(ORIGIN+path)))return false;
  return true;
 }catch{return false;}
}
function askClients(clients,type,updateId){
 if(!clients.length)return Promise.resolve(false);
 const requestId=crypto.randomUUID();
 return new Promise(resolve=>{
  const expected=new Set(clients.map(c=>c.id));
  const timer=setTimeout(()=>{rounds.delete(requestId);resolve(false);},5000);
  rounds.set(requestId,{receive:(id,ready,locked,receivedUpdateId)=>{
   if(!expected.has(id))return;
   if(ready!==true||locked!==true||receivedUpdateId!==updateId){clearTimeout(timer);rounds.delete(requestId);resolve(false);return;}
   expected.delete(id);if(!expected.size){clearTimeout(timer);rounds.delete(requestId);resolve(true);}
  }});
  for(const client of clients)client.postMessage({type,requestId,updateId,buildId:BUILD});
 });
}
self.addEventListener('message',event=>{
 const d=event.data,source=event.source;
 if(d?.type==='WB_READY'){if(source?.id)rounds.get(d.requestId)?.receive(source.id,d.ready,d.locked,d.updateId);return;}
 if(d?.type==='WB_STATUS'){event.waitUntil((async()=>{event.ports?.[0]?.postMessage({ready:await isBuildReady(d.buildId),buildId:d.buildId});})());return;}
 if(d?.type==='WB_CANCEL_UPDATE'){
  const valid=transaction?.id===d.updateId&&transaction.clients.some(c=>c.id===source?.id);
  const cancellable=valid&&!['activating','active'].includes(transaction.phase);
  if(cancellable){transaction.cancelled=true;transaction.phase='aborted';notify(transaction.clients,'WB_ABORT_UPDATE',transaction.id);}
  event.ports?.[0]?.postMessage({cancelled:!!cancellable,updateId:d.updateId});return;
 }
 if(d?.type!=='WB_REQUEST_UPDATE')return;
 event.waitUntil((async()=>{
  const reply=value=>event.ports?.[0]?.postMessage({accepted:value});
  if(updating){reply(false);return;}updating=true;
  const attempt={id:crypto.randomUUID(),clients:[],cancelled:false,activated:false,phase:'collecting'};transaction=attempt;
  try{
   const clients=await scopedClients();attempt.clients=clients;
   if(!clients.some(c=>c.id===source?.id)||!await askClients(clients,'WB_PREPARE_UPDATE',attempt.id)){reply(false);return;}
   const current=await scopedClients();
   if(current.length!==clients.length||current.some(c=>!clients.some(p=>p.id===c.id))||!await askClients(current,'WB_COMMIT_UPDATE',attempt.id)){reply(false);return;}
   const final=await scopedClients();
   if(attempt.cancelled||final.length!==current.length||final.some(c=>!current.some(p=>p.id===c.id))){reply(false);return;}
   // Set the point of no return synchronously before invoking skipWaiting.
   attempt.phase='activating';await self.skipWaiting();attempt.phase='active';attempt.activated=true;reply(true);
  }catch{reply(false);}finally{if(!attempt.activated){attempt.phase='aborted';notify(attempt.clients,'WB_ABORT_UPDATE',attempt.id);}updating=false;}
 })());
});
`;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const outDir=resolve('dist-browser'),base=validateBrowserBase(process.env.WORKBENCH_BROWSER_BASE??'/learn/');
 const {buildId,base:builtBase}=JSON.parse(await readFile(join(outDir,'browser-build.json'),'utf8'));
 if(base!==builtBase)throw new Error('Build and service worker bases differ');
 await copyBrowserNotices({sourceDir:resolve('.'),outDir});
 await generateBrowserServiceWorker({outDir,base,buildId});
 console.log('Browser service worker generated for '+base+' ('+buildId+')');
}
