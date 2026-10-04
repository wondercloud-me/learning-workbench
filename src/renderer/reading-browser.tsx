import React,{useEffect,useRef,useState} from 'react';
import {readerUrl,READER_HOME,type ReaderStatus} from '../core/reader';
import type {LessonDocument} from '../core/curriculum';
import {MaterialContent} from './course-home';
import {Icon} from './shell';
import './reading-browser.css';
export interface ReadingRequest {url:string;id:string}
export function ReadingBrowser({initialUrl,request,visible,blocked,onPage,onTeach}:{initialUrl:string;request:ReadingRequest|null;visible:boolean;blocked:boolean;onPage:(s:ReaderStatus)=>void;onTeach:(url:string)=>void}){
 const [status,setStatus]=useState<ReaderStatus>({url:initialUrl,title:'菜鸟教程',loading:true,error:'',canBack:false,canForward:false,cached:false});
 const [address,setAddress]=useState(initialUrl),[offline,setOffline]=useState(false),[document,setDocument]=useState<LessonDocument|null>(null),[cacheLoading,setCacheLoading]=useState(false),[localError,setLocalError]=useState('');
 const awaitingNavigation=useRef<number|null>(null),lastNavigation=useRef(-1),seenRequest=useRef<string|null>(null);
 if(request&&request.id!==seenRequest.current){seenRequest.current=request.id;awaitingNavigation.current=lastNavigation.current;}
 const viewport=useRef<HTMLDivElement>(null),pageCallback=useRef(onPage);pageCallback.current=onPage;
 const navigate=(url:string)=>{try{url=readerUrl(url);awaitingNavigation.current=lastNavigation.current;setLocalError('');setOffline(false);void window.workbench.readerNavigate(url).catch(e=>setLocalError(String(e)));}catch(e){setLocalError(String(e));}};
 useEffect(()=>{const stop=window.workbench.onReaderUpdate(s=>{if(s.navigation!==undefined&&s.navigation<lastNavigation.current)return;if(awaitingNavigation.current!==null&&s.navigation!==undefined&&s.navigation<=awaitingNavigation.current)return;awaitingNavigation.current=null;if(s.navigation!==undefined)lastNavigation.current=s.navigation;setStatus(s);setAddress(s.url);pageCallback.current(s);});navigate(initialUrl);return stop;},[]);
 useEffect(()=>{if(request)navigate(request.url);},[request?.id]);
 const fallback=offline||!!status.error;
 useEffect(()=>{let current=true;setDocument(null);if(fallback){setCacheLoading(true);window.workbench.readerCached(status.url).then(doc=>{if(current){setDocument(doc);setCacheLoading(false);}}).catch(()=>{if(current)setCacheLoading(false);});}return()=>{current=false;};},[status.url,fallback,status.cached]);
 useEffect(()=>{
  const element=viewport.current;if(!element)return;
  const sync=()=>{const r=element.getBoundingClientRect();void window.workbench.readerViewport({x:r.x,y:r.y,width:r.width,height:r.height},visible&&!fallback&&!blocked).catch(()=>{});};
  sync();const observer=new ResizeObserver(sync);observer.observe(element);window.addEventListener('resize',sync);
  return()=>{observer.disconnect();window.removeEventListener('resize',sync);void window.workbench.readerViewport(null,false).catch(()=>{});};
 },[visible,fallback,blocked]);
 const action=(which:'back'|'forward'|'reload'|'home')=>{awaitingNavigation.current=null;setOffline(false);setLocalError('');void window.workbench.readerAction(which).catch(e=>setLocalError(String(e)));};
 return <section className='reading-browser' hidden={!visible} aria-label='教程网页阅读'>
  <div className='reader-toolbar'>
   <button className='icon-button' aria-label='返回上一网页' disabled={!status.canBack} onClick={()=>action('back')}><Icon name='arrow-left'/></button>
   <button className='icon-button' aria-label='前进网页' disabled={!status.canForward} onClick={()=>action('forward')}><Icon name='arrow-right'/></button>
   <button className='icon-button' aria-label='刷新教程网页' onClick={()=>action('reload')}><Icon name='refresh'/></button>
   <button className='icon-button' aria-label='菜鸟教程首页' onClick={()=>action('home')}><Icon name='home'/></button>
   <form className='reader-address' onSubmit={e=>{e.preventDefault();navigate(address);}}><Icon name='globe'/><input aria-label='教程网址' value={address} onChange={e=>setAddress(e.target.value)}/></form>
   <button className={offline?'reader-offline selected':'reader-offline'} onClick={()=>setOffline(v=>!v)}><Icon name='book'/>{offline?'回到网页':'离线文字'}</button>
   <button className='primary' disabled={status.loading} onClick={()=>onTeach(status.url)}><Icon name='hubot'/>教我这一节</button>
  </div>
  {localError&&<div className='alert error'>{localError}</div>}
  <div className='reader-meta'><span>{status.loading?'正在打开网页…':status.title}</span><small>{status.cached?'已缓存正文文字':'阅读不调用 AI · 不计掌握证据'}</small></div>
  <div ref={viewport} className='reader-viewport'>
   {fallback&&<div className='reader-offline-page'><div className='reader-fallback-note'><strong>{status.error?'网页暂时不可用':'离线文字备用'}</strong><p>{status.error||'显示已缓存的完整正文；原站图片和交互需要联网。'}</p><button onClick={()=>action('reload')}>重试网页</button></div>
    {cacheLoading?<p role='status'>正在读取本机缓存…</p>:document?<article><h1>{document.title}</h1><nav aria-label='离线章节小节'>{document.sections.map(s=><a key={s.id} href={`#offline-${s.id}`}>{s.title}</a>)}</nav>{document.sections.map(s=><section key={s.id} id={`offline-${s.id}`}><h2>{s.title}</h2><MaterialContent blocks={s.blocks}/></section>)}<footer>来源：{document.url}<br/>缓存时间：{new Date(document.fetchedAt).toLocaleString()}</footer></article>:<p>此页还没有可用的正文缓存。联网后打开一个教程章节，就会自动保存文字；首页等目录页不作为教案。</p>}
   </div>}
  </div>
 </section>;
}
