import {afterEach, describe, expect, it, vi} from 'vitest';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import vm from 'node:vm';
import {build} from 'vite';

const generatorPath = resolve('scripts/build-browser-sw.mjs');
const folders:string[]=[];
afterEach(async()=>{vi.unstubAllGlobals();await Promise.all(folders.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
async function fixture(realBuild=false,base='/learning-workbench/learn/',buildId='build-a'){
 const outDir=await mkdtemp(join(tmpdir(),'workbench-pwa-'));folders.push(outDir);
 if(realBuild){
  const root=await mkdtemp(join(tmpdir(),'workbench-pwa-graph-'));folders.push(root);
  await writeFile(join(root,'index.html'),'<script type="module" src="/entry.ts"></script>');
  await writeFile(join(root,'entry.ts'),`import {executeLab} from ${JSON.stringify(resolve('src/renderer/lab-client.ts'))}; window.executeLab = executeLab;`);
  await build({configFile:false,root,base,build:{outDir,emptyOutDir:true,assetsInlineLimit:0},logLevel:'silent'});
 }else{
  await mkdir(join(outDir,'assets')); await writeFile(join(outDir,'index.html'),'<h1>shell</h1>');
  await writeFile(join(outDir,'assets/lab.worker-a.js'),'worker'); await writeFile(join(outDir,'assets/quickjs-a.wasm'),'wasm');
 }
 await writeFile(join(outDir,'manifest.webmanifest'),JSON.stringify({id:'/learn/',start_url:'/learn/',scope:'/learn/',icons:[]}));
 const generator=await import(generatorPath);
 await generator.generateBrowserServiceWorker({outDir,base,buildId});
 return {outDir,base,code:await readFile(join(outDir,'sw.js'),'utf8')};
}
function serviceWorker(code:string, options:{failedAsset?:string; clients?:Array<{id:string;url?:string;ready?:boolean|boolean[];locked?:boolean;onMessage?:(data:any,reply:(data:any,ports?:MessagePort[])=>void)=>void}>; previous?:Map<string,Map<string,Response>>;skipWaiting?:()=>Promise<void>}={}){
 const handlers=new Map<string,Function>();const stores=options.previous??new Map<string,Map<string,Response>>();let activated=false;
 const fetched:string[]=[];
 const clients=(options.clients??[]).map(c=>{let replyIndex=0;return {...c, url:c.url??'https://workbench.test/learning-workbench/learn/',postMessage:(data:any)=>{const reply=(data:any,ports?:MessagePort[])=>handlers.get('message')?.({data,ports,source:{id:c.id}});if(c.onMessage){c.onMessage(data,reply);return;}if(!['WB_PREPARE_UPDATE','WB_COMMIT_UPDATE'].includes(data.type))return;if(c.ready!==undefined)queueMicrotask(()=>handlers.get('message')?.({data:{type:'WB_READY',requestId:data.requestId,ready:Array.isArray(c.ready)?c.ready[replyIndex++]:c.ready,locked:c.locked??true,updateId:data.updateId},source:{id:c.id}}));}};});
 const caches={keys:async()=>[...stores.keys()],delete:async(key:string)=>stores.delete(key),open:async(key:string)=>{if(!stores.has(key))stores.set(key,new Map());const store=stores.get(key)!;return{put:async(request:string|Request,response:Response)=>{store.set(typeof request==='string'?request:request.url,response.clone());},match:async(request:string|Request)=>store.get(typeof request==='string'?request:request.url)?.clone()};}};
 const self={location:new URL('https://workbench.test/learning-workbench/learn/sw.js'),registration:{scope:'https://workbench.test/learning-workbench/learn/'},clients:{matchAll:async()=>clients},addEventListener:(name:string,fn:Function)=>handlers.set(name,fn),skipWaiting:async()=>{activated=true;await options.skipWaiting?.();}};
 vm.runInNewContext(code,{self,caches,URL,Request,Response,Set,Map,Promise,crypto:globalThis.crypto,setTimeout:(fn:Function)=>setTimeout(fn,20),clearTimeout,fetch:async(request:string|Request)=>{const url=typeof request==='string'?request:request.url;fetched.push(url);if(url.includes(options.failedAsset??'__no_failure__'))throw Error('offline');return new Response(url);}});
 async function event(name:string,data:any={}){let pending:Promise<any>|undefined;let response:Promise<Response>|undefined;handlers.get(name)?.({...data,waitUntil:(p:Promise<any>)=>pending=p,respondWith:(p:Promise<Response>)=>response=p});await pending;return response?await response:undefined;}
 return {event,stores,fetched,activated:()=>activated};
}
describe('browser PWA generated worker',()=>{
 it('includesWasmWorkerAndNonRootUrlsFromRealBuild',async()=>{
  const f=await fixture(true);const sw=serviceWorker(f.code);await sw.event('install');
  expect(sw.fetched.some(p=>p.includes('/learning-workbench/learn/assets/')&&p.endsWith('.wasm'))).toBe(true);
  expect(sw.fetched.some(p=>p.includes('/learning-workbench/learn/assets/lab.worker-'))).toBe(true);
  expect(sw.fetched.every(p=>p.startsWith('https://workbench.test/learning-workbench/learn/'))).toBe(true);
  const manifest=JSON.parse(await readFile(join(f.outDir,'manifest.webmanifest'),'utf8'));expect([manifest.id,manifest.start_url,manifest.scope]).toEqual([f.base,f.base,f.base]);
 });
 it('neverCachesApiAuthorizationOrExternalRequests',async()=>{
  const f=await fixture();const sw=serviceWorker(f.code);await sw.event('install');
  for(const request of [new Request('https://workbench.test/api/model'),new Request('https://workbench.test/learning-workbench/learn/api/model'),new Request('https://external.test/model'),new Request('https://workbench.test/learning-workbench/learn/assets/quickjs-a.wasm',{headers:{Authorization:'secret'}})]){
   expect(await sw.event('fetch',{request})).toBeUndefined();
  }
  expect(sw.fetched).toHaveLength(4);
 });
 it('keepsOldCacheWhenRequiredInstallAssetFails',async()=>{
  const f=await fixture();const old=new Map([['growth-workbench-shell-old',new Map([['old',new Response('old')]])]]);
  const sw=serviceWorker(f.code,{previous:old,failedAsset:'.wasm'});await expect(sw.event('install')).rejects.toThrow('offline');
  expect([...old.keys()]).toEqual(['growth-workbench-shell-old']);expect(sw.activated()).toBe(false);
 });
 it.each([[false],[undefined]])('doesNotActivateWhileAnyClientHasUnsavedWork or does not respond (%s)',async(ready)=>{
  const f=await fixture();const sw=serviceWorker(f.code,{clients:[{id:'safe',ready:true},{id:'unsafe',ready}]});let result:any;
  await sw.event('message',{data:{type:'WB_REQUEST_UPDATE'},source:{id:'safe'},ports:[{postMessage:(r:any)=>result=r}]});
  expect(result.accepted).toBe(false);expect(sw.activated()).toBe(false);
 });
 it('activatesOnlyAfterEveryClientConfirmsTwice',async()=>{
  const f=await fixture();const sw=serviceWorker(f.code,{clients:[{id:'a',ready:true},{id:'b',ready:true}]});let result:any;
  await sw.event('message',{data:{type:'WB_REQUEST_UPDATE'},source:{id:'a'},ports:[{postMessage:(r:any)=>result=r}]});
  expect(result.accepted).toBe(true);expect(sw.activated()).toBe(true);
 });
 it('keepsWaitingWhenAnOldClientAcknowledgesWithoutAnUpdateBarrier',async()=>{
  const f=await fixture(),sw=serviceWorker(f.code,{clients:[{id:'a',ready:true},{id:'legacy',ready:true,locked:false}]});let result:any;
  await sw.event('message',{data:{type:'WB_REQUEST_UPDATE'},source:{id:'a'},ports:[{postMessage:(r:any)=>result=r}]});
  expect(result.accepted).toBe(false);expect(sw.activated()).toBe(false);
 });
 it('refusesActivationWhenWorkStartsBetweenPreparationAndCommit',async()=>{
  const f=await fixture();const sw=serviceWorker(f.code,{clients:[{id:'a',ready:[true,true]},{id:'b',ready:[true,false]}]});let result:any;
  await sw.event('message',{data:{type:'WB_REQUEST_UPDATE'},source:{id:'a'},ports:[{postMessage:(r:any)=>result=r}]});
  expect(result.accepted).toBe(false);expect(sw.activated()).toBe(false);
 });
 it('offlineNavigationUsesOnlyItsBuildAndNeverAddsRuntimeResponses',async()=>{
  const f=await fixture();const sw=serviceWorker(f.code);await sw.event('install');
  const request={url:'https://workbench.test/learning-workbench/learn/',method:'GET',mode:'navigate',headers:new Headers()};
  const shell=await sw.event('fetch',{request});expect(await shell!.text()).toContain('/learning-workbench/learn/index.html');
  const asset=await sw.event('fetch',{request:new Request('https://workbench.test/learning-workbench/learn/assets/quickjs-a.wasm')});expect(await asset!.text()).toContain('quickjs-a.wasm');
  expect(await sw.event('fetch',{request:new Request('https://workbench.test/learning-workbench/learn/my-backup.json')})).toBeUndefined();
  expect(sw.fetched).toHaveLength(4);
 });
 it('retainsOldBuildWhileAnUnresponsivePageRemainsOpen',async()=>{
  const f=await fixture();const old=new Map([['growth-workbench-shell-old',new Map([['old',new Response('old')]])]]);
  const sw=serviceWorker(f.code,{previous:old,clients:[{id:'old'}]});await sw.event('install');await sw.event('activate');
  expect(old.has('growth-workbench-shell-old')).toBe(true);
 });
 it('isolatesSiblingBaseCacheCleanupAndKeepsTheOtherLiveShell',async()=>{
  const a=await fixture(false,'/learn/'),b=await fixture(false,'/learning-workbench/learn/','build-b');const stores=new Map<string,Map<string,Response>>();
  const old=serviceWorker(a.code,{previous:stores,clients:[{id:'learn-page',url:'https://workbench.test/learn/'}]});await old.event('install');
  const newer=serviceWorker(b.code,{previous:stores,clients:[{id:'learn-page',url:'https://workbench.test/learn/'}]});await newer.event('install');await newer.event('activate');
  const shell=await old.event('fetch',{request:{url:'https://workbench.test/learn/',method:'GET',mode:'navigate',headers:new Headers()}});
  expect(shell!.status).toBe(200);expect(await shell!.text()).toContain('https://workbench.test/learn/index.html');expect(stores.size).toBe(2);
 });
 it.each(['missing','partial','wrong-build'])('reportsUnavailableFor%sCacheInsteadOfClaimingOfflineReady',async(damage)=>{
  const f=await fixture(),sw=serviceWorker(f.code);await sw.event('install');
  const store=[...sw.stores.values()][0];
  if(damage==='missing')sw.stores.clear();
  if(damage==='partial')store.delete('https://workbench.test/learning-workbench/learn/assets/quickjs-a.wasm');
  if(damage==='wrong-build')store.set('https://workbench.test/learning-workbench/learn/__wb_cache_build__',new Response(JSON.stringify({buildId:'other-build',base:f.base,complete:true,assets:[f.base+'index.html']})));
  let status:any;await sw.event('message',{data:{type:'WB_STATUS',buildId:'build-a'},ports:[{postMessage:(r:any)=>status=r}]});
  expect(status.ready).toBe(false);
 });
 it('onlyReportsTheRequestedCompleteBuildAsOfflineReady',async()=>{
  const f=await fixture(),sw=serviceWorker(f.code);await sw.event('install');let status:any;
  const ports=[{postMessage:(r:any)=>status=r}];
  await sw.event('message',{data:{type:'WB_STATUS',buildId:'not-this-build'},ports});expect(status.ready).toBe(false);
  await sw.event('message',{data:{type:'WB_STATUS',buildId:'build-a'},ports});expect(status).toMatchObject({ready:true,buildId:'build-a'});
 });
 it('rejectsInvalidBaseBeforeGenerating',async()=>{
  const generator=await import(generatorPath);
  for(const base of ['learn/','/learn','//evil/','/learn/../','/learn/?x/'])await expect(generator.generateBrowserServiceWorker({outDir:'/not-used',base,buildId:'test'})).rejects.toThrow();
 });
 it('shipsOriginal192And512IconsIncludingMaskable',async()=>{
  const manifest=JSON.parse(await readFile('browser/public/manifest.webmanifest','utf8'));
  for(const size of [192,512]){
   const icon=manifest.icons.find((i:any)=>i.sizes===`${size}x${size}`&&i.purpose==='any');expect(icon).toBeDefined();
   const png=await readFile(join('browser/public',icon.src));expect(png.readUInt32BE(16)).toBe(size);expect(png.readUInt32BE(20)).toBe(size);
  }
  const icon=manifest.icons.find((i:any)=>i.purpose==='maskable');expect(icon).toBeDefined();
 });
});

describe('browser install',()=>{
 it('acceptedPromptDoesNotClaimInstalledBeforeSystemConfirmation',async()=>{
  const path=resolve('src/browser/pwa.ts');const {registerBrowserPwa}=await import(path);
  const events=new Map<string,Function>();
  vi.stubGlobal('navigator',{serviceWorker:{register:async()=>({active:null,waiting:null,installing:null,addEventListener:()=>{},removeEventListener:()=>{}}),addEventListener:()=>{},removeEventListener:()=>{}}});
  vi.stubGlobal('window',{isSecureContext:true,matchMedia:()=>({matches:false}),addEventListener:(n:string,f:Function)=>events.set(n,f),removeEventListener:()=>{}});
  const controller=await registerBrowserPwa('/learn/',{flush:async()=>{},isBusy:()=>false,hasPending:()=>false,acquireUpdateLock:()=>()=>{}});
  events.get('beforeinstallprompt')!({preventDefault:()=>{},prompt:async()=>{},userChoice:Promise.resolve({outcome:'accepted'})});
  expect(controller.status().install).toBe('prompt');expect(await controller.install()).toBe('accepted');
  expect(controller.status().install).toBe('manual');events.get('appinstalled')!();expect(controller.status().install).toBe('installed');controller.dispose();
 });
});

describe('browser cached build status',()=>{
 it.each([false,'different-build'])('doesNotClaimOfflineReadyWhenWorkerReports%s',async(answer)=>{
  const {registerBrowserPwa}=await import(resolve('src/browser/pwa.ts'));let request:any;
  vi.stubGlobal('__WB_BROWSER_BUILD_ID__','loaded-build');
  vi.stubGlobal('navigator',{serviceWorker:{register:async()=>({active:{postMessage:(data:any,ports:MessagePort[])=>{request=data;ports[0].postMessage({ready:answer!==false,buildId:answer===false?'loaded-build':'different-build'});ports[0].close();}},waiting:null,installing:null,addEventListener:()=>{},removeEventListener:()=>{}}),addEventListener:()=>{},removeEventListener:()=>{}}});
  vi.stubGlobal('window',{isSecureContext:true,matchMedia:()=>({matches:false}),addEventListener:()=>{},removeEventListener:()=>{}});
  const pwa=await registerBrowserPwa('/learn/',{flush:async()=>{},isBusy:()=>false,hasPending:()=>false,acquireUpdateLock:()=>()=>{}});
  expect(request).toEqual({type:'WB_STATUS',buildId:'loaded-build'});expect(pwa.status().phase).toBe('not-ready');pwa.dispose();
 });
});

describe('browser readiness',()=>{
 it.each(['flush','busy','pending'])('refuses readiness when %s prevents safe updates',async(reason)=>{
  const path=resolve('src/browser/pwa.ts');const {registerBrowserPwa}=await import(path);
  const listeners=new Map<string,Function>();
  const sw={register:async()=>({active:null,waiting:null,installing:null,addEventListener:()=>{},removeEventListener:()=>{}}),addEventListener:(n:string,f:Function)=>listeners.set(n,f),removeEventListener:()=>{}};
  vi.stubGlobal('navigator',{serviceWorker:sw});vi.stubGlobal('window',{isSecureContext:true,matchMedia:()=>({matches:false}),addEventListener:()=>{},removeEventListener:()=>{}});
  const controller=await registerBrowserPwa('/learn/',{flush:async()=>{if(reason==='flush')throw Error('save failed');},isBusy:()=>reason==='busy',hasPending:()=>reason==='pending',acquireUpdateLock:()=>()=>{}});
  let response:any;await listeners.get('message')!({data:{type:'WB_PREPARE_UPDATE',requestId:'r',updateId:'attempt',buildId:'new-build'},source:{postMessage:(r:any)=>response=r}});
  expect(response.ready).toBe(false);controller.dispose();
 });
});

describe('held PWA update barrier',()=>{
 it.each(['activation','timeout'])('preventsAnEarlyClientEditingOrStartingAnOperationAfterCommitWhileAnotherClientFlushes until %s',async(outcome)=>{
  const {registerBrowserPwa}=await import(resolve('src/browser/pwa.ts'));
  const listeners=new Map<string,Function>();let locked=false;let editing='saved';let operating=false;
  vi.stubGlobal('navigator',{serviceWorker:{register:async()=>({active:null,waiting:null,installing:null,addEventListener:()=>{},removeEventListener:()=>{}}),addEventListener:(n:string,f:Function)=>listeners.set(n,f),removeEventListener:()=>{}}});
  vi.stubGlobal('window',{isSecureContext:true,matchMedia:()=>({matches:false}),addEventListener:()=>{},removeEventListener:()=>{}});
  const pwa=await registerBrowserPwa('/learning-workbench/learn/',{flush:async()=>{},isBusy:()=>operating,hasPending:()=>editing!=='saved',acquireUpdateLock:()=>{locked=true;return()=>{locked=false;};}});
  const edit=()=>{if(locked)throw Error('update barrier');editing='unsaved';};const operate=()=>{if(locked)throw Error('update barrier');operating=true;};
  const f=await fixture();let lastClientCommit:(()=>void)|undefined;
  const sw=serviceWorker(f.code,{clients:[
   {id:'early',onMessage:(data,reply)=>{void listeners.get('message')!({data,source:{postMessage:reply}});}},
   {id:'late',onMessage:(data,reply)=>{if(data.type==='WB_PREPARE_UPDATE')reply({type:'WB_READY',requestId:data.requestId,updateId:data.updateId,ready:true,locked:true});if(data.type==='WB_COMMIT_UPDATE')lastClientCommit=()=>reply({type:'WB_READY',requestId:data.requestId,updateId:data.updateId,ready:true,locked:true});}}
  ]});
  let accepted:any;const update=sw.event('message',{data:{type:'WB_REQUEST_UPDATE'},source:{id:'early'},ports:[{postMessage:(r:any)=>accepted=r}]});
  for(let turn=0;turn<15&&!lastClientCommit;turn++)await new Promise(resolve=>setTimeout(resolve,0));
  expect(lastClientCommit).toBeDefined();expect(()=>edit()).toThrow('update barrier');expect(()=>operate()).toThrow('update barrier');
  if(outcome==='activation'){lastClientCommit!();await update;expect(accepted.accepted).toBe(true);expect(locked).toBe(true);await sw.event('activate');}
  else{await update;expect(accepted.accepted).toBe(false);expect(sw.activated()).toBe(false);}
  expect(locked).toBe(false);pwa.dispose();
 });
});

describe('update transaction ownership',()=>{
 async function page(flush:()=>Promise<void>){
  const {registerBrowserPwa}=await import(resolve('src/browser/pwa.ts'));const listeners=new Map<string,Function>();let locked=false;
  vi.stubGlobal('navigator',{serviceWorker:{register:async()=>({active:null,waiting:null,installing:null,addEventListener:()=>{},removeEventListener:()=>{}}),addEventListener:(n:string,f:Function)=>listeners.set(n,f),removeEventListener:(n:string)=>listeners.delete(n)}});
  vi.stubGlobal('window',{isSecureContext:true,matchMedia:()=>({matches:false}),addEventListener:()=>{},removeEventListener:()=>{}});
  const pwa=await registerBrowserPwa('/learn/',{flush,isBusy:()=>false,hasPending:()=>false,acquireUpdateLock:()=>{if(locked)throw Error('already locked');locked=true;return()=>{locked=false;};}});
  return {pwa,listeners,locked:()=>locked,message:(data:any,source:any)=>listeners.get('message')!({data,source})};
 }
 it.each(['resolve','reject'])('abortedOldPrepare%sDoesNotReleaseANewerCommittedBarrier',async(outcome)=>{
  let finishA!:()=>void;let failA!:(e:Error)=>void;let flushes=0;
  const deferred=new Promise<void>((resolve,reject)=>{finishA=resolve;failA=reject;});const p=await page(async()=>{if(++flushes===1)await deferred;});
  const source={postMessage:()=>{}};
  const old=p.message({type:'WB_PREPARE_UPDATE',requestId:'a1',updateId:'A',buildId:'new'},source);
  await p.message({type:'WB_ABORT_UPDATE',updateId:'A'},source);
  await p.message({type:'WB_PREPARE_UPDATE',requestId:'b1',updateId:'B',buildId:'new'},source);
  await p.message({type:'WB_COMMIT_UPDATE',requestId:'b2',updateId:'B',buildId:'new'},source);expect(p.locked()).toBe(true);
  if(outcome==='resolve')finishA();else failA(Error('old save failed'));await old;expect(p.locked()).toBe(true);
  await p.message({type:'WB_ABORT_UPDATE',updateId:'B'},source);expect(p.locked()).toBe(false);p.pwa.dispose();
 });
 it('aRejectedNewPrepareWhoseReplyThrowsCannotReleaseTheCommittedOwner',async()=>{
  const p=await page(async()=>{}),source={postMessage:()=>{}};
  await p.message({type:'WB_PREPARE_UPDATE',requestId:'b1',updateId:'B',buildId:'new'},source);
  await p.message({type:'WB_COMMIT_UPDATE',requestId:'b2',updateId:'B',buildId:'new'},source);
  await p.message({type:'WB_PREPARE_UPDATE',requestId:'c1',updateId:'C',buildId:'new'},{postMessage:()=>{throw Error('unreachable source');}});
  expect(p.locked()).toBe(true);await p.message({type:'WB_ABORT_UPDATE',updateId:'B'},source);p.pwa.dispose();
 });
 it.each([true,false])('disposeKeepsCommittedBarrierUntilAuthoritativeAbortOrActivationWhenCancellationIs%s',async(cancelled)=>{
  const p=await page(async()=>{});let cancellation:MessagePort[]|undefined;
  const source={postMessage:(data:any,ports?:MessagePort[])=>{if(data.type==='WB_CANCEL_UPDATE')cancellation=ports;}};
  await p.message({type:'WB_PREPARE_UPDATE',requestId:'p',updateId:'A',buildId:'new'},source);
  await p.message({type:'WB_COMMIT_UPDATE',requestId:'c',updateId:'A',buildId:'new'},source);
  p.pwa.dispose();expect(p.locked()).toBe(true);expect(cancellation).toBeDefined();
  cancellation![0].postMessage({cancelled,updateId:'A'});cancellation![0].close();await new Promise(resolve=>setTimeout(resolve,0));
  if(!cancelled){expect(p.locked()).toBe(true);expect(p.listeners.has('message')).toBe(true);await p.message({type:'WB_ACTIVATED_UPDATE',buildId:'new'},source);}
  expect(p.locked()).toBe(false);expect(p.listeners.has('message')).toBe(false);
 });
 it('workerRejectsCancellationAfterSkipWaitingWasInvokedEvenBeforeItsPromiseResolves',async()=>{
  const f=await fixture();let resolveActivation!:()=>void;let began=false;let updateId:string|undefined;
  const sw=serviceWorker(f.code,{skipWaiting:()=>{began=true;return new Promise(resolve=>resolveActivation=resolve);},clients:[{id:'a',onMessage:(data,reply)=>{if(['WB_PREPARE_UPDATE','WB_COMMIT_UPDATE'].includes(data.type)){updateId=data.updateId;reply({type:'WB_READY',requestId:data.requestId,updateId,ready:true,locked:true});}}}]});
  let result:any;const updating=sw.event('message',{data:{type:'WB_REQUEST_UPDATE'},source:{id:'a'},ports:[{postMessage:(r:any)=>result=r}]});
  for(let i=0;i<10&&!began;i++)await new Promise(resolve=>setTimeout(resolve,0));expect(began).toBe(true);
  let cancellation:any;await sw.event('message',{data:{type:'WB_CANCEL_UPDATE',updateId},source:{id:'a'},ports:[{postMessage:(r:any)=>cancellation=r}]});
  expect(cancellation).toEqual({cancelled:false,updateId});resolveActivation();await updating;expect(result.accepted).toBe(true);
 });
});
