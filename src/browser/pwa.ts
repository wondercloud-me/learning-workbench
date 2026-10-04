export type PwaStatus={phase:'not-ready'|'offline-ready'|'update-waiting'|'error';install:'prompt'|'manual'|'installed'|'unsupported';message:string};
export interface PwaController {status():PwaStatus;subscribe(listener:()=>void):()=>void;install():Promise<'accepted'|'dismissed'|'manual'|'unsupported'>;requestUpdate():Promise<boolean>;dispose():void;}
interface InstallPrompt extends Event {prompt():Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>;}
declare const __WB_BROWSER_BUILD_ID__:string;
export type PwaReadiness={flush:()=>Promise<void>;isBusy:()=>boolean;hasPending:()=>boolean;acquireUpdateLock:()=>()=>void};

export async function registerBrowserPwa(base:string,readiness:PwaReadiness):Promise<PwaController>{
 if(!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base))throw Error('无效的应用路径');
 const supported=typeof window!=='undefined'&&window.isSecureContext&&'serviceWorker' in navigator;
 let value:PwaStatus={phase:'not-ready',install:supported?'manual':'unsupported',message:supported?'首次使用需联网下载，下载成功后才能离线学习。':'当前环境不支持离线安装；请通过 HTTPS 打开。'};
 const listeners=new Set<()=>void>();const cleanup:Array<()=>void>=[];let prompt:InstallPrompt|undefined,registration:ServiceWorkerRegistration|undefined,disposed=false,requesting=false;
 const update=(next:Partial<PwaStatus>)=>{if(disposed)return;value={...value,...next};for(const listener of listeners)listener();};
 const installed=()=>window.matchMedia?.('(display-mode: standalone)').matches||(navigator as Navigator&{standalone?:boolean}).standalone===true;
 const manualMessage='在 iPhone Safari 中点分享，再选“添加到主屏幕”；其他浏览器请从菜单选择安装应用。';
 const buildId=typeof __WB_BROWSER_BUILD_ID__==='undefined'?undefined:__WB_BROWSER_BUILD_ID__;
 type UpdateBarrier={id:string;buildId:string;source:ServiceWorker;release:()=>void;committed:boolean;timer?:ReturnType<typeof setTimeout>;cancelCleanup?:()=>void};
 let barrier:UpdateBarrier|undefined;
 const finishDisposal=()=>{if(disposed&&!barrier)for(const remove of cleanup.splice(0))remove();};
 const releaseBarrier=(expected:UpdateBarrier|undefined)=>{
  if(!expected||barrier!==expected)return;
  clearTimeout(expected.timer);expected.cancelCleanup?.();barrier=undefined;expected.release();finishDisposal();
 };
 const cancelBarrier=(expected:UpdateBarrier|undefined=barrier)=>{
  if(!expected||barrier!==expected||expected.cancelCleanup)return;
  const channel=new MessageChannel();
  const close=()=>{clearTimeout(timer);channel.port1.close();expected.cancelCleanup=undefined;};
  const timer=setTimeout(close,12000);expected.cancelCleanup=close;
  channel.port1.onmessage=event=>{
   const data=event.data;close();
   // Cancellation may be rejected once skipWaiting has crossed its point of no return.
   if(data?.cancelled===true&&data.updateId===expected.id)releaseBarrier(expected);
  };
  try{expected.source.postMessage({type:'WB_CANCEL_UPDATE',updateId:expected.id},[channel.port2]);}catch{close();}
 };
 const ready=async()=>{try{if(readiness.isBusy())return false;await readiness.flush();return !readiness.isBusy()&&!readiness.hasPending();}catch{return false;}};
 const listen=(target:EventTarget,name:string,handler:EventListener)=>{target.addEventListener(name,handler);cleanup.push(()=>target.removeEventListener(name,handler));};
 const query=(worker:ServiceWorker,type:string):Promise<any>=>new Promise(resolve=>{
  const channel=new MessageChannel();const timer=setTimeout(()=>{channel.port1.close();resolve(undefined);},12000);
  channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data);};
  try{worker.postMessage({type,buildId},[channel.port2]);}catch{clearTimeout(timer);channel.port1.close();resolve(undefined);}
 });
 const inspect=async()=>{
  if(registration?.waiting){update({phase:'update-waiting',message:'有新版本。保存并更新前会检查所有打开的学习页面。'});return;}
  if(registration?.active){const result=await query(registration.active,'WB_STATUS');if(result?.ready===true&&result.buildId===buildId&&buildId)update({phase:'offline-ready',message:'离线资源已就绪；首次未联网下载的设备仍需联网打开。'});else update({phase:'not-ready',message:'当前版本离线资源不可用。请联网重新下载；学习内容已保留。'});}
 };
 const controller:PwaController={
  status:()=>({...value}),subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
  async install(){
   if(value.install==='unsupported')return 'unsupported';
   if(!prompt){update({message:manualMessage});return 'manual';}
   const event=prompt;prompt=undefined;
   try{await event.prompt();const {outcome}=await event.userChoice;update({install:value.install==='installed'?'installed':'manual',message:outcome==='accepted'?'已接受安装，请检查系统主屏幕。':manualMessage});return outcome;}catch{update({install:'manual',message:manualMessage});return 'manual';}
  },
  async requestUpdate(){
   if(disposed||requesting||!registration?.waiting)return false;requesting=true;
   try{
    if(!await ready()){update({message:'请等待运行结束并保存当前内容后更新。'});return false;}
    const result=await query(registration.waiting,'WB_REQUEST_UPDATE');
    if(result?.accepted!==true){update({message:'更新暂未开始。请保存并关闭其他学习页面，再重试；无法确认的页面会阻止更新。'});return false;}
    update({message:'所有学习页面已确认保存，新版本正在启用。刷新页面可载入新版本。'});return true;
   }finally{requesting=false;}
  },
  dispose(){disposed=true;listeners.clear();cancelBarrier();finishDisposal();}
 };
 if(!supported)return controller;
 if(installed())value.install='installed';
 listen(window,'beforeinstallprompt',((event:InstallPrompt)=>{event.preventDefault();prompt=event;update({install:'prompt'});}) as EventListener);
 listen(window,'appinstalled',()=>{prompt=undefined;update({install:'installed'});});
 listen(navigator.serviceWorker,'message',((event:MessageEvent)=>{
  const data=event.data,source=event.source as ServiceWorker|null;
  if(!source)return;
  if(data?.type==='WB_ABORT_UPDATE'&&barrier?.id===data.updateId){releaseBarrier(barrier);return;}
  if(data?.type==='WB_ACTIVATED_UPDATE'&&barrier?.buildId===data.buildId){releaseBarrier(barrier);return;}
  if(!['WB_PREPARE_UPDATE','WB_COMMIT_UPDATE'].includes(data?.type))return;
  if(disposed){source.postMessage({type:'WB_READY',requestId:data.requestId,updateId:data.updateId,ready:false,locked:false,buildId});return;}
  const respond=(safe:boolean)=>source.postMessage({type:'WB_READY',requestId:data.requestId,updateId:data.updateId,ready:safe,locked:safe&&!!barrier,buildId});
  return (async()=>{
   let owned:UpdateBarrier|undefined;
   try{
    if(typeof data.updateId!=='string'||typeof readiness.acquireUpdateLock!=='function'){respond(false);return;}
    if(data.type==='WB_PREPARE_UPDATE'){
     if(barrier||readiness.isBusy()){respond(false);return;}
     const release=readiness.acquireUpdateLock();
     if(typeof release!=='function'){respond(false);return;}
     owned={id:data.updateId,buildId:data.buildId,source,release,committed:false};barrier=owned;
     const acquired=owned;owned.timer=setTimeout(()=>{if(barrier===acquired&&!acquired.committed)cancelBarrier(acquired);},12000);
    }
    if(!barrier||barrier.id!==data.updateId){respond(false);return;}
    owned=barrier;const safe=await ready();
    if(!safe||barrier!==owned){if(owned.committed)cancelBarrier(owned);else releaseBarrier(owned);respond(false);return;}
    if(data.type==='WB_COMMIT_UPDATE'){
     // Once committed, hold until activation/explicit worker abort. A local timeout
     // must never unlock while a delayed activation can still occur.
     owned.committed=true;clearTimeout(owned.timer);
    }
    respond(true);
   }catch{if(owned?.committed)cancelBarrier(owned);else releaseBarrier(owned);try{respond(false);}catch{/* Unreachable clients cannot authorize activation. */}}
  })();
 }) as EventListener);
 listen(navigator.serviceWorker,'controllerchange',()=>{releaseBarrier(barrier);void inspect();});
 try{
  registration=await navigator.serviceWorker.register(base+'sw.js',{scope:base,updateViaCache:'none'});
  const observeWorker=()=>{const worker=registration?.installing;if(!worker)return;listen(worker,'statechange',()=>{
   if(worker.state==='installed'||worker.state==='activated')void inspect();
   if(worker.state==='redundant')update({phase:'error',message:'离线资源下载失败。请联网重试；已有内容已保留。'});
  });};
  listen(registration,'updatefound',observeWorker);observeWorker();await inspect();
 }catch(error){update({phase:'error',message:`离线安装失败：${error instanceof Error?error.message:String(error)}。请联网重试，学习内容已保留。`});}
 return controller;
}
