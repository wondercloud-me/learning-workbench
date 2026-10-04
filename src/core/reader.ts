import catalog from '../data/runoob-catalog.json';
import type {Course,LessonDocument} from './curriculum';
export const READER_HOME='https://www.runoob.com/';
export interface ReaderStatus {navigation?:number;url:string;title:string;loading:boolean;error:string;canBack:boolean;canForward:boolean;cached:boolean}
export interface ReaderRect {x:number;y:number;width:number;height:number}
export interface ReaderSelection {url:string;title:string;quote:string;sourceMessage:string}
export function readerUrl(value:string):string {
 const u=new URL(value);if(u.protocol!=='https:'||u.hostname!=='www.runoob.com'||u.port||u.username||u.password)throw new Error('资料浏览只支持菜鸟教程 HTTPS 页面');return u.href;
}
export function readerBounds(value:unknown,width:number,height:number):ReaderRect|null {
 if(!value||typeof value!=='object')return null;const r=value as ReaderRect;
 if(![r.x,r.y,r.width,r.height].every(Number.isFinite)||r.width<=0||r.height<=0)return null;
 const x=Math.max(0,Math.round(r.x)),y=Math.max(0,Math.round(r.y));const w=Math.min(Math.round(r.width),width-x),h=Math.min(Math.round(r.height),height-y);
 return w>0&&h>0?{x,y,width:w,height:h}:null;
}
export function readerCourse(url:string,title:string):Course {
 const u=new URL(readerUrl(url)),directory=u.pathname.split('/').filter(Boolean)[0];
 const known=catalog.categories.flatMap(c=>c.courses).find(c=>new URL(c.url).pathname.split('/').filter(Boolean)[0]===directory);
 return known||{id:directory||'runoob',title:title||'菜鸟教程',description:'原站章节',url:u.origin+u.pathname};
}
export function readerSelection(url:string,title:string,quote:string,doc:LessonDocument|null):ReaderSelection {
 url=readerUrl(url);quote=quote.trim().slice(0,8000);if(!quote)throw new Error('请先选中文字');
 const normalized=(s:string)=>s.replace(/\s+/g,' ').trim();
 const block=doc?.sections.flatMap(s=>s.blocks).find(b=>'text' in b&&normalized(b.text).includes(normalized(quote)));
 const text=block&&'text' in block?block.text.slice(0,12000):quote;
 return {url,title:title.slice(0,200),quote,sourceMessage:`资料：${title.slice(0,200)}\n来源：${url}\n${text.includes(quote)?text:quote}`};
}
