import { parse, type HTMLElement, type Node } from 'node-html-parser';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { CourseDirectory, LessonDocument, LessonSection, MaterialBlock, TutorialStats } from '../core/curriculum';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
export function tutorialUrl(value:string,base?:string):string {
 const u=new URL(value,base); if(u.protocol!=='https:'||u.hostname!=='www.runoob.com'||u.port||u.username||u.password)throw new Error('只允许菜鸟教程 HTTPS 链接');
 u.hash='';u.search='';return u.href;
}
export function parseCourse(html:string,url:string):CourseDirectory {
 url=tutorialUrl(url); const root=parse(html);const seen=new Set<string>();const chapters:CourseDirectory['chapters']=[];
 for(const a of root.querySelectorAll('#leftcolumn a')){try{const link=tutorialUrl(a.getAttribute('href')||'',url);const title=a.text.trim();if(!title||!a.getAttribute('href')||seen.has(link))continue;seen.add(link);chapters.push({title,url:link});}catch{}}
 if(!chapters.length)throw new Error('无法读取课程目录，请打开原站查看或稍后重试');
 return {url,title:root.querySelector('h1')?.text.trim()||root.querySelector('title')?.text.split('|')[0].trim()||'课程',chapters};
}
function textWithBreaks(node:Node):string {
 if(node.nodeType===3)return node.textContent;
 const el=node as HTMLElement;if(el.tagName==='BR')return '\n';
 return el.childNodes.map(textWithBreaks).join('');
}
export function parseLesson(html:string,url:string,fetchedAt:string):LessonDocument {
 url=tutorialUrl(url);const root=parse(html,{blockTextElements:{script:true,style:true}});const body=root.querySelector('.article-intro');if(!body)throw new Error('没有可读取的教程正文，不能开始 AI 教学');
 for(const el of body.querySelectorAll('script,style,iframe,textarea,form,button,nav,.adsbygoogle,.advertisement,.tryitbtn,.tryit-button,.comments'))el.remove();
 const title=body.querySelector('h1')?.text.trim()||root.querySelector('title')?.text.split('|')[0].trim()||'教程';
 const sections:LessonSection[]=[];const counts=new Map<string,number>();
 function section(name:string){const count=counts.get(name)||0;counts.set(name,count+1);const s={id:hash(`${url}\n${name}\n${count}`).slice(0,16),title:name,blocks:[] as MaterialBlock[]};sections.push(s);return s;}
 let current=section('概览');
 function visit(node:Node){
  if(node.nodeType!==1)return;const el=node as HTMLElement, tag=el.tagName;
  if(tag==='H1')return;
  if(tag==='H2'||tag==='H3'){const name=el.text.trim();if(name&&!/^(实例|示例|例子|运行结果|输出结果)\s*[:：\d]*$/.test(name))current=section(name);return;}
  if(tag==='PRE'||el.classNames.includes('hl-main')){const text=textWithBreaks(el).replace(/\r/g,'').replace(/^\n|\n$/g,'');if(text.trim())current.blocks.push({kind:'code',text});return;}
  if(tag==='TABLE'){const rows=el.querySelectorAll('tr').map(row=>row.querySelectorAll('th,td').map(cell=>cell.text.trim()));if(rows.length)current.blocks.push({kind:'table',rows});return;}
  if(tag==='IMG'){try{const image=tutorialUrl(el.getAttribute('src')||'',url);current.blocks.push({kind:'image',url:image,alt:el.getAttribute('alt')||'教程配图'});}catch{}return;}
  if(tag==='P'||tag==='LI'||tag==='BLOCKQUOTE'){const text=textWithBreaks(el).trim();if(text)current.blocks.push({kind:'paragraph',text});for(const image of el.querySelectorAll('img'))visit(image);return;}
  if(tag==='VIDEO'||tag==='AUDIO'){current.blocks.push({kind:'link',url,title:'在原教程查看媒体'});return;}
  if(el.classNames.includes('example_code')){const text=textWithBreaks(el).trim();if(text)current.blocks.push({kind:'code',text});return;}
  for(const child of el.childNodes)visit(child);
 }
 for(const child of body.childNodes)visit(child);
 const useful=sections.filter(s=>s.blocks.length);if(!useful.length)throw new Error('教程正文为空，不能开始 AI 教学');
 return {url,title,version:hash(JSON.stringify({title,sections:useful})),fetchedAt,sections:useful};
}
type Entry={url:string;kind:'course'|'lesson';access:number;pinned:boolean;value:CourseDirectory|LessonDocument};
/** A serialized disk cache. Only parsed source data is stored; student work lives elsewhere. */
export class TutorialStore {
 private queue:Promise<unknown>=Promise.resolve();private entries=new Map<string,Entry>();private initialized=false;
 private readonly budget:number;private readonly fetcher:typeof fetch;
 constructor(private readonly dir:string,options:{fetcher?:typeof fetch;budget?:number}={}){this.budget=options.budget??50*1024*1024;this.fetcher=options.fetcher??fetch;}
 private key(kind:string,url:string){return hash(kind+url);}
 private file(key:string){return path.join(this.dir,key+'.json');}
 private bytes(entry:Entry){return Buffer.byteLength(JSON.stringify(entry));}
 private serial<T>(fn:()=>Promise<T>):Promise<T>{const next=this.queue.then(async()=>{await this.init();return fn();});this.queue=next.catch(()=>{});return next;}
 private async init(){if(this.initialized)return;await mkdir(this.dir,{recursive:true});for(const filename of await readdir(this.dir)){if(!/^[a-f0-9]{64}\.json$/.test(filename))continue;try{const entry=JSON.parse(await readFile(path.join(this.dir,filename),'utf8')) as Entry;if(tutorialUrl(entry.url)!==entry.url||!['course','lesson'].includes(entry.kind)||!entry.value)throw new Error();this.entries.set(filename.slice(0,-5),entry);}catch{await unlink(path.join(this.dir,filename)).catch(()=>{});}}this.initialized=true;}
 private async write(key:string,entry:Entry){const file=this.file(key),temp=file+'.tmp';await writeFile(temp,JSON.stringify(entry));await rename(temp,file);this.entries.set(key,entry);}
 private async page(url:string):Promise<string>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{let response:Response|undefined;for(let redirects=0;redirects<=3;redirects++){response=await this.fetcher(url,{redirect:'manual',signal:controller.signal});if([301,302,303,307,308].includes(response.status)){await response.body?.cancel();url=tutorialUrl(response.headers.get('location')||'',url);continue;}break;}
   if(!response?.ok)throw new Error(`教程请求失败（${response?.status}），请稍后重试`);
   if(Number(response.headers.get('content-length'))>2*1024*1024){await response.body?.cancel();throw new Error('教程单页超过 2 MiB');}
   const reader=response.body?.getReader();if(!reader)throw new Error('教程响应为空');const chunks:Uint8Array[]=[];let bytes=0;
   while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>2*1024*1024){await reader.cancel();throw new Error('教程单页超过 2 MiB');}chunks.push(part.value);}
   return Buffer.concat(chunks).toString('utf8');
  }catch(error){if(controller.signal.aborted)throw new Error('教程读取超时（20 秒），请检查网络后重试');throw error;}finally{clearTimeout(timer);}
 }
 private async get(kind:'course'|'lesson',url:string,refresh=false){url=tutorialUrl(url);const key=this.key(kind,url),saved=this.entries.get(key);
  if(saved&&!refresh){saved.access=Date.now();await this.write(key,saved);return saved.value;}
  const html=await this.page(url);const value=kind==='course'?parseCourse(html,url):parseLesson(html,url,new Date().toISOString());
  return this.store(kind,url,value,saved);
 }
 private async store(kind:Entry["kind"],url:string,value:Entry["value"],saved?:Entry){
  const key=this.key(kind,url);
  const entry:Entry={url,kind,value,pinned:saved?.pinned??false,access:Date.now()};const size=this.bytes(entry);
  const others=[...this.entries.entries()].filter(([id])=>id!==key);
  const fixed=others.filter(([,e])=>e.pinned).reduce((sum,[,e])=>sum+this.bytes(e),0);
  if(size+fixed>this.budget)throw new Error('缓存空间不足，请取消部分离线固定或清理缓存');
  let total=size+others.reduce((sum,[,e])=>sum+this.bytes(e),0);
  for(const [id,e] of others.filter(([,e])=>!e.pinned).sort((a,b)=>a[1].access-b[1].access)){if(total<=this.budget)break;await unlink(this.file(id));this.entries.delete(id);total-=this.bytes(e);}
  await this.write(key,entry);return value;
 }
 course(url:string,refresh=false):Promise<CourseDirectory>{return this.serial(()=>this.get('course',url,refresh) as Promise<CourseDirectory>);}
 lesson(url:string,refresh=false):Promise<LessonDocument>{return this.serial(()=>this.get('lesson',url,refresh) as Promise<LessonDocument>);}
 cachedLesson(url:string):Promise<LessonDocument|null>{return this.serial(async()=>this.entries.get(this.key('lesson',tutorialUrl(url)))?.value as LessonDocument||null);}
 capture(url:string,html:string):Promise<LessonDocument>{return this.serial(async()=>{
  url=tutorialUrl(url);if(Buffer.byteLength(html)>2*1024*1024)throw new Error('教程单页超过 2 MiB');
  const doc=parseLesson(html,url,new Date().toISOString());
  return await this.store('lesson',url,doc,this.entries.get(this.key('lesson',url))) as LessonDocument;
 });}

 pin(url:string,pinned:boolean):Promise<TutorialStats>{return this.serial(async()=>{url=tutorialUrl(url);const key=this.key('lesson',url),entry=this.entries.get(key);if(!entry)throw new Error('请先读取章节再固定');await this.write(key,{...entry,pinned:pinned===true});return this.summary();});}
 stats():Promise<TutorialStats>{return this.serial(async()=>this.summary());}
 status(url:string):Promise<boolean>{return this.serial(async()=>this.entries.get(this.key('lesson',tutorialUrl(url)))?.pinned===true);}
 clear(includePinned=false):Promise<TutorialStats>{return this.serial(async()=>{for(const [key,entry] of this.entries){if(entry.pinned&&!includePinned)continue;await unlink(this.file(key));this.entries.delete(key);}return this.summary();});}
 private summary():TutorialStats{return{bytes:[...this.entries.values()].reduce((sum,e)=>sum+this.bytes(e),0),budget:this.budget,entries:this.entries.size,pinned:[...this.entries.values()].filter(e=>e.pinned).length};}
}
