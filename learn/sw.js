/* Generated from this browser build. Never cache user or API data. */
const BASE="/learning-workbench/learn/", BUILD="85106eeb-496f-4673-8615-7512f1d7ee9c";
const PREFIX='growth-workbench-shell-'+encodeURIComponent(BASE)+'-';
const CACHE=PREFIX+BUILD;
const ASSETS=["/learning-workbench/learn/LICENSE","/learning-workbench/learn/THIRD_PARTY_NOTICES.md","/learning-workbench/learn/assets/codicon-CMYWzYni.ttf","/learning-workbench/learn/assets/emscripten-module-uFzwHH0Y.wasm","/learning-workbench/learn/assets/emscripten-module.browser-4bm0-Lq_.js","/learning-workbench/learn/assets/ffi-4V2b7xu3.js","/learning-workbench/learn/assets/index-B4Q4EvQk.css","/learning-workbench/learn/assets/index-kJIr2zqy.js","/learning-workbench/learn/assets/lab.worker-BBi5kU8p.js","/learning-workbench/learn/assets/module-ES6BEMUI-CKOwToNo.js","/learning-workbench/learn/browser-build.json","/learning-workbench/learn/icons/README.md","/learning-workbench/learn/icons/icon-192.png","/learning-workbench/learn/icons/icon-512.png","/learning-workbench/learn/icons/maskable-512.png","/learning-workbench/learn/index.html","/learning-workbench/learn/licenses/Learning-Workbench-LICENSE.txt","/learning-workbench/learn/licenses/NOTICE.md","/learning-workbench/learn/licenses/SenseVoice-MODEL-LICENSE.txt","/learning-workbench/learn/licenses/THIRD_PARTY_NOTICES.md","/learning-workbench/learn/licenses/ThreadPool-LICENSE.txt","/learning-workbench/learn/licenses/boolbase-1.0.0-LICENSE","/learning-workbench/learn/licenses/css-select-5.2.2-LICENSE","/learning-workbench/learn/licenses/css-what-6.2.2-LICENSE","/learning-workbench/learn/licenses/diff-9.0.0-LICENSE","/learning-workbench/learn/licenses/dom-serializer-2.0.0-LICENSE","/learning-workbench/learn/licenses/domelementtype-2.3.0-LICENSE","/learning-workbench/learn/licenses/domhandler-5.0.3-LICENSE","/learning-workbench/learn/licenses/dompurify-3.4.8-LICENSE","/learning-workbench/learn/licenses/dompurify-3.4.8-LICENSE-MPL","/learning-workbench/learn/licenses/domutils-3.2.2-LICENSE","/learning-workbench/learn/licenses/eigen-COPYING-MPL2.txt","/learning-workbench/learn/licenses/electron-LICENSE.txt","/learning-workbench/learn/licenses/entities-4.5.0-LICENSE","/learning-workbench/learn/licenses/entities-8.1.0-LICENSE","/learning-workbench/learn/licenses/hclust-cpp-LICENSE.txt","/learning-workbench/learn/licenses/jitl-quickjs-ffi-types-0.32.0-LICENSE","/learning-workbench/learn/licenses/jitl-quickjs-wasmfile-release-sync-0.32.0-LICENSE","/learning-workbench/learn/licenses/kaldi-decoder-LICENSE.txt","/learning-workbench/learn/licenses/kaldi-native-fbank-LICENSE.txt","/learning-workbench/learn/licenses/kaldifst-LICENSE.txt","/learning-workbench/learn/licenses/kissfft-BSD-3-Clause.txt","/learning-workbench/learn/licenses/kissfft-COPYING.txt","/learning-workbench/learn/licenses/marked-14.0.0-LICENSE.md","/learning-workbench/learn/licenses/monaco-editor-0.56.0-LICENSE","/learning-workbench/learn/licenses/nlohmann-json-LICENSE.txt","/learning-workbench/learn/licenses/node-html-parser-9.0.4-LICENSE","/learning-workbench/learn/licenses/npm-license-manifest.json","/learning-workbench/learn/licenses/nth-check-2.1.1-LICENSE","/learning-workbench/learn/licenses/onnxruntime-LICENSE.txt","/learning-workbench/learn/licenses/onnxruntime-ThirdPartyNotices.txt","/learning-workbench/learn/licenses/openfst-AUTHORS.txt","/learning-workbench/learn/licenses/openfst-LICENSE.txt","/learning-workbench/learn/licenses/quickjs-emscripten-core-0.32.0-LICENSE","/learning-workbench/learn/licenses/react-19.3.0-LICENSE","/learning-workbench/learn/licenses/react-dom-19.3.0-LICENSE","/learning-workbench/learn/licenses/scheduler-0.28.0-LICENSE","/learning-workbench/learn/licenses/sherpa-onnx-LICENSE.txt","/learning-workbench/learn/licenses/simple-sentencepiece-LICENSE.txt","/learning-workbench/learn/licenses/types-trusted-types-2.0.7-LICENSE","/learning-workbench/learn/licenses/vscode-codicons-0.0.46-24-LICENSE","/learning-workbench/learn/licenses/vscode-codicons-0.0.46-24-LICENSE-CODE","/learning-workbench/learn/manifest.webmanifest"];
const ORIGIN=self.location.origin;
const URLS=new Set(ASSETS.map(p=>ORIGIN+p));
const SHELL=ORIGIN+BASE+'index.html';
const META=ORIGIN+BASE+'__wb_cache_build__';
const rounds=new Map();
let updating=false,transaction;
const notify=(clients,type,updateId)=>{for(const client of clients)client.postMessage({type,updateId,buildId:BUILD});};
const scopedClients=async()=> (await self.clients.matchAll({type:'window',includeUncontrolled:true})).filter(c=>c.url.startsWith(ORIGIN+BASE));
self.addEventListener('install',event=>event.waitUntil((async()=>{
 try {
  // Fetch every required resource before committing any part of this version.
  const responses=await Promise.all(ASSETS.map(async p=>{
   const url=ORIGIN+p, response=await fetch(new Request(url,{cache:'reload',credentials:'omit',redirect:'error'}));
   if(!response.ok||response.type==='opaque'||(response.url&&new URL(response.url).origin!==ORIGIN))throw Error('Required offline asset unavailable: '+p);
   return [url,response];
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
