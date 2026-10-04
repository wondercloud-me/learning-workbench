import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseCourse, parseLesson, TutorialStore, tutorialUrl } from '../src/node/tutorials';
const url='https://www.runoob.com/python3/python3-loop.html';
const html=`<script>outside()</script><div id="leftcolumn"><a href="/python3/python3-tutorial.html">Python3 教程</a><a href="/python3/python3-loop.html">Python3 循环</a><a href="https://evil.test">bad</a></div><div class="article-intro" id="content"><h1>Python3 循环</h1><p>循环重复执行动作。<script>steal()</script></p><h2>while 循环</h2><p>条件为真时执行。</p><div class="example"><h2>实例</h2><pre>a = 1<br>while a &lt; 3:<br>    print(a)<br>    a += 1</pre></div><table><tr><th>名称</th><th>作用</th></tr><tr><td>break</td><td>退出</td></tr></table><h2>for 循环</h2><p>遍历列表。</p><img src="//www.runoob.com/wp-content/uploads/test.png" alt="流程"><iframe>evil</iframe></div><div class="comments">private comment</div>`;
const response=(body=html)=>new Response(body,{headers:{'content-type':'text/html'}});
describe('on-demand tutorials',()=>{
 it('extracts real directory and safe ordered sections, preserving runnable code and tables',()=>{
  expect(parseCourse(html,url).chapters.map(x=>x.title)).toEqual(['Python3 教程','Python3 循环']);
  const lesson=parseLesson(html,url,'now');
  expect(lesson.sections.map(x=>x.title)).toEqual(['概览','while 循环','for 循环']);
  expect(lesson.sections[1].blocks).toContainEqual({kind:'code',text:'a = 1\nwhile a < 3:\n    print(a)\n    a += 1'});
  expect(lesson.sections[1].blocks).toContainEqual({kind:'table',rows:[['名称','作用'],['break','退出']]});
  expect(JSON.stringify(lesson)).not.toMatch(/steal|evil|private comment/);
  expect(parseLesson(html,url,'later').version).toBe(lesson.version);
  expect(()=>parseLesson('<div>blocked</div>',url,'now')).toThrow(/正文/);
 });
 it('rejects foreign URLs, credentials, ports and unsafe redirects without contacting destination',async()=>{
  for(const value of ['http://www.runoob.com/a.html','https://evil.test/a','https://x@www.runoob.com/a','https://www.runoob.com:444/a'])expect(()=>tutorialUrl(value)).toThrow();
  const dir=await mkdtemp(path.join(os.tmpdir(),'tutorial-'));
  let calls=0;
  try {const store=new TutorialStore(dir,{fetcher:async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1:1234/'}});}});await expect(store.lesson(url)).rejects.toThrow();expect(calls).toBe(1);}finally{await rm(dir,{recursive:true,force:true});}
 });
 it('bounds streamed pages even without Content-Length',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'tutorial-'));
  try{const store=new TutorialStore(dir,{fetcher:async()=>response('x'.repeat(2*1024*1024+1))});await expect(store.lesson(url)).rejects.toThrow(/2 MiB/);}finally{await rm(dir,{recursive:true,force:true});}
 });
 it('survives restart offline, serializes concurrent writes, evicts LRU and keeps pins within budget',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'tutorial-'));let calls=0;
  const fetcher=async()=>{calls++;return response();};
  try{
   const store=new TutorialStore(dir,{fetcher});
   await Promise.all([store.lesson(url),store.lesson(url)]);expect(calls).toBe(1);
   await store.pin(url,true); const first=await store.stats();expect(first.pinned).toBe(1);
   const offline=new TutorialStore(dir,{fetcher:async()=>{throw new Error('offline');}});
   expect((await offline.lesson(url)).title).toBe('Python3 循环');
   await offline.clear();expect((await offline.stats()).entries).toBe(1);
   const small=new TutorialStore(dir,{fetcher,budget:first.bytes+20});
   await expect(small.lesson(url.replace('loop','list'))).rejects.toThrow(/固定|缓存/);
   expect((await small.stats()).bytes).toBeLessThanOrEqual(first.bytes+20);
   await small.pin(url,false);await small.lesson(url.replace('loop','list'));
   expect((await small.stats()).entries).toBe(1);
   await small.clear();expect((await small.stats()).entries).toBe(0);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
});
