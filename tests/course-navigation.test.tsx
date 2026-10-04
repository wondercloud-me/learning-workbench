// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect} from 'vitest';
import {CourseHome} from '../src/renderer/course-home';
import {emptyState} from '../src/core/state';
import type {CourseDirectory} from '../src/core/curriculum';
it('ignores an old manual refresh when navigating to a different course',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const calls:Array<{url:string;resolve:(d:CourseDirectory)=>void}>=[];
 (window as any).workbench={tutorialCourse:(url:string)=>new Promise<CourseDirectory>(resolve=>calls.push({url,resolve})),tutorialExternal:async()=>{}};
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const click=async(text:string)=>{const button=[...host.querySelectorAll('button')].find(b=>b.textContent?.includes(text));if(!button)throw new Error('button '+text+' missing');await act(async()=>button.click());};
 try{
  await act(async()=>root.render(<CourseHome state={emptyState()} busy={false} onOpenLesson={async()=>{}} onResume={()=>{}}/>));
  await click('后端开发');await click('Node.js');
  await act(async()=>calls[0].resolve({url:calls[0].url,title:'Node',chapters:[{title:'NODE INITIAL',url:calls[0].url}]}));
  await click('刷新目录');await click('首页');await click('Python / 数据科学');await click('Python3');
  expect(calls).toHaveLength(3);
  await act(async()=>calls[2].resolve({url:calls[2].url,title:'Python',chapters:[{title:'PYTHON CURRENT',url:calls[2].url}]}));
  await act(async()=>calls[1].resolve({url:calls[1].url,title:'Node',chapters:[{title:'STALE NODE REFRESH',url:calls[1].url}]}));
  expect(host.textContent).toContain('PYTHON CURRENT');expect(host.textContent).not.toContain('STALE NODE REFRESH');
 }finally{await act(async()=>root.unmount());host.remove();}
});
