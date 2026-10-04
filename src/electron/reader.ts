import {WebContentsView,Menu,dialog,shell,type BrowserWindow} from 'electron';
import {readerBounds,readerUrl,readerSelection,READER_HOME,type ReaderRect,type ReaderStatus} from '../core/reader';
import {TutorialStore} from '../node/tutorials';

/** Remote website owns no preload or native bridge. One view is shared by all reading pages. */
export class TutorialReader {
 private view:WebContentsView;
 private status:ReaderStatus={url:READER_HOME,title:'菜鸟教程',loading:false,error:'',canBack:false,canForward:false,cached:false};
 private wanted=false;private rect:ReaderRect|null=null;private generation=0;
 constructor(private host:BrowserWindow,private store:TutorialStore){
  this.view=new WebContentsView({webPreferences:{partition:'persist:tutorial-reader',nodeIntegration:false,nodeIntegrationInWorker:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  const wc=this.view.webContents;
  wc.session.setPermissionCheckHandler(()=>false);
  wc.session.setPermissionRequestHandler((_wc,_permission,done)=>done(false));
  wc.session.on('will-download',event=>event.preventDefault());
  const navigation=(event:Electron.Event,url:string)=>{try{readerUrl(url);}catch{event.preventDefault();void this.external(url);}};
  wc.on('will-navigate',navigation);wc.on('will-redirect',navigation);
  wc.setWindowOpenHandler(({url})=>{try{readerUrl(url);void this.navigate(url);}catch{void this.external(url);}return {action:'deny'};});
  wc.on('did-start-navigation',(_e,url,inPlace,main)=>{if(!main)return;try{readerUrl(url);}catch{return;}this.generation++;this.status={...this.status,url,error:'',loading:!inPlace,cached:false};this.emit();});
  wc.on('page-title-updated',(_e,title)=>{this.status.title=title.slice(0,200);this.emit();});
  wc.on('did-navigate-in-page',(_e,url,main)=>{if(main){this.status.url=url;this.status.loading=false;this.emit();void this.cached(this.generation);}});
  wc.on('did-fail-load',(_e,code,description,url,main)=>{if(!main||code===-3||url!==this.status.url)return;this.status={...this.status,url,loading:false,error:`网页暂时无法打开（${description}）。可查看已缓存文字或重试。`};this.view.setVisible(false);this.emit();void this.cached(this.generation);});
  wc.on('did-finish-load',()=>{if(this.status.error)return;this.status={...this.status,url:wc.getURL(),title:wc.getTitle().slice(0,200),loading:false,error:''};this.layout();this.emit();void this.capture(this.generation);});
  wc.on('render-process-gone',()=>{this.status.loading=false;this.status.error='网页进程已停止，请刷新重试。';this.view.setVisible(false);this.emit();});
  wc.on('context-menu',(_e,params)=>{
   if(!params.selectionText.trim())return;
   const url=wc.getURL(),title=wc.getTitle(),quote=params.selectionText;
   Menu.buildFromTemplate([{label:'辅助对话',click:()=>{void this.store.cachedLesson(url).then(doc=>{const context=readerSelection(url,title,quote,doc);this.host.webContents.send('reader:selection',context);}).catch(()=>{});}},{type:'separator'},{role:'copy'}]).popup({window:this.host});
  });
  host.contentView.addChildView(this.view);this.view.setVisible(false);
  host.on('resize',()=>this.layout());
  host.on('closed',()=>{if(!wc.isDestroyed())wc.close();});
 }
 private emit(){if(this.host.isDestroyed())return;const wc=this.view.webContents;this.status.canBack=wc.navigationHistory.canGoBack();this.status.canForward=wc.navigationHistory.canGoForward();this.host.webContents.send('reader:update',{...this.status,navigation:this.generation});}
 private layout(){if(this.host.isDestroyed())return;const [w,h]=this.host.getContentSize();const bounds=readerBounds(this.rect,w,h);this.view.setVisible(this.wanted&&!!bounds&&!this.status.error);if(bounds)this.view.setBounds(bounds);}
 viewport(rect:unknown,visible:boolean){const [w,h]=this.host.getContentSize();this.rect=readerBounds(rect,w,h);this.wanted=visible===true;this.layout();return {...this.status};}
 async navigate(url:string){url=readerUrl(url);this.generation++;this.status.url=url;this.status.error='';this.status.loading=true;this.layout();this.emit();try{await this.view.webContents.loadURL(url);}catch{ /* did-fail-load owns the error UI */ }return {...this.status};}
 action(action:'back'|'forward'|'reload'|'home'){
  const wc=this.view.webContents;
  if(action==='home')void this.navigate(READER_HOME);
  else if(action==='reload'){this.status.error='';this.layout();wc.reload();}
  else if(action==='back'&&wc.navigationHistory.canGoBack())wc.navigationHistory.goBack();
  else if(action==='forward'&&wc.navigationHistory.canGoForward())wc.navigationHistory.goForward();
 }
 private async cached(generation:number){const doc=await this.store.cachedLesson(this.status.url).catch(()=>null);if(generation===this.generation){this.status.cached=!!doc;this.emit();}}
 private async capture(generation:number){
  const wc=this.view.webContents,url=wc.getURL();
  try{
   // Read rendered material only. No preload, credentials or app APIs enter the website.
   const page=await wc.executeJavaScript('({url:location.href,html:document.documentElement.outerHTML.length<=2097152?document.documentElement.outerHTML:null})') as {url:string;html:string|null};
   if(generation!==this.generation||page.url!==url||!page.html)return;
   await this.store.capture(url,page.html);if(generation===this.generation){this.status.cached=true;this.emit();}
  }catch{await this.cached(generation); /* Non-tutorial pages still work as normal web pages. */}
 }
 private async external(url:string){
  let target:URL;try{target=new URL(url);}catch{return;}
  if(!['https:','http:'].includes(target.protocol)||target.username||target.password)return;
  const {response}=await dialog.showMessageBox(this.host,{type:'question',message:'在系统浏览器打开外部链接？',detail:target.href,buttons:['取消','打开'],defaultId:0,cancelId:0});
  if(response===1)await shell.openExternal(target.href);
 }
}
