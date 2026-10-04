// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import {ReadingBrowser} from '../src/renderer/reading-browser';
import {openTab,closeTab,reopenTab,emptyTabs} from '../src/core/tabs';
import type {ReaderStatus} from '../src/core/reader';
it('reads without invoking teaching and ignores stale offline material',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 (globalThis as any).ResizeObserver=class{observe(){}disconnect(){}};
 let update:(s:ReaderStatus)=>void=()=>{};
 const requests:Array<{url:string;resolve:(d:any)=>void}>=[];
 (window as any).workbench={readerViewport:async()=>{},readerNavigate:async()=>{},readerAction:async()=>{},onReaderUpdate:(cb:any)=>{update=cb;return()=>{};},readerCached:(url:string)=>new Promise(resolve=>requests.push({url,resolve}))};
 const onTeach=vi.fn();const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const page=(url:string):ReaderStatus=>({url,title:url,loading:false,error:'offline',canBack:false,canForward:false,cached:true});
 try{
  await act(async()=>root.render(<ReadingBrowser initialUrl='https://www.runoob.com/' request={null} visible={true} blocked={false} onPage={()=>{}} onTeach={onTeach}/>));
  await act(async()=>update(page('https://www.runoob.com/a/one.html')));
  expect(onTeach).not.toHaveBeenCalled();
  await act(async()=>update(page('https://www.runoob.com/a/two.html')));
  expect(requests).toHaveLength(2);
  const doc=(url:string,name:string)=>({url,title:name,version:'v',fetchedAt:'now',sections:[{id:'a',title:'第一节',blocks:[{kind:'paragraph',text:name+'第一段'}]},{id:'b',title:'第二节',blocks:[{kind:'code',text:'print(2)'}]}]});
  await act(async()=>requests.at(-1)!.resolve(doc('https://www.runoob.com/a/two.html','CURRENT')));
  await act(async()=>requests[0].resolve(doc('https://www.runoob.com/a/one.html','STALE')));
  expect(host.textContent).toContain('CURRENT第一段');expect(host.textContent).toContain('print(2)');expect(host.textContent).not.toContain('STALE');
  const teach=[...host.querySelectorAll('button')].find(b=>b.textContent?.includes('教我这一节'))!;
  await act(async()=>teach.click());expect(onTeach).toHaveBeenCalledWith('https://www.runoob.com/a/two.html');
 }finally{await act(async()=>root.unmount());host.remove();}
});
it('closing and restoring a teaching tab preserves its own chapter binding',()=>{
 let tabs=openTab(emptyTabs(),{id:'teach:a',kind:'teaching',title:'循环',resource:'chapter-a'});
 tabs=openTab(tabs,{id:'teach:b',kind:'teaching',title:'函数',resource:'chapter-b'});
 tabs=closeTab(tabs,'teach:a');expect(tabs.activeId).toBe('teach:b');
 tabs=reopenTab(tabs);expect(tabs.tabs.find(t=>t.id===tabs.activeId)?.resource).toBe('chapter-a');
});
it('restored reading request navigates to the backup page and rejects delayed old navigation events',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;(globalThis as any).ResizeObserver=class{observe(){}disconnect(){}};
 let update:(s:ReaderStatus)=>void=()=>{};const navigated:string[]=[];const saved:string[]=[];
 (window as any).workbench={readerViewport:async()=>{},readerNavigate:async(url:string)=>{navigated.push(url);},readerAction:async()=>{},onReaderUpdate:(cb:any)=>{update=cb;return()=>{};},readerCached:async()=>null};
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const a='https://www.runoob.com/a/one.html',b='https://www.runoob.com/a/two.html';
 const props={initialUrl:a,visible:true,blocked:false,onPage:(s:ReaderStatus)=>saved.push(s.url),onTeach:()=>{}};
 const status=(url:string,navigation:number)=>({url,navigation,title:url,loading:false,error:'',canBack:false,canForward:false,cached:false});
 try{
  await act(async()=>root.render(<ReadingBrowser {...props} request={null}/>));await act(async()=>update(status(a,1)));
  await act(async()=>root.render(<ReadingBrowser {...props} request={{url:b,id:'restore'}}/>));
  expect(navigated.at(-1)).toBe(b);
  const before=saved.length;await act(async()=>update(status(a,1)));expect(saved).toHaveLength(before);
  await act(async()=>update(status(b,3)));await act(async()=>update(status(a,1)));
  expect(host.querySelector<HTMLInputElement>('[aria-label="教程网址"]')?.value).toBe(b);expect(saved.at(-1)).toBe(b);
 }finally{await act(async()=>root.unmount());host.remove();}
});
