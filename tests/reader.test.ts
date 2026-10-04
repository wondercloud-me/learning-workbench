import {describe,it,expect} from 'vitest';
import {readerUrl,readerBounds,readerCourse,readerSelection} from '../src/core/reader';
import {emptyState,validateState,cleanBackup} from '../src/core/state';
import {TutorialStore} from '../src/node/tutorials';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
describe('reader isolation and persistence',()=>{
 it('keeps same-site query and fragment but rejects dangerous navigation',()=>{
  expect(readerUrl('https://www.runoob.com/python3/python3-loop.html?q=x#while')).toBe('https://www.runoob.com/python3/python3-loop.html?q=x#while');
  for(const url of ['file:///etc/passwd','javascript:alert(1)','https://www.runoob.com.evil.test/','https://x:y@www.runoob.com/','http://www.runoob.com/','https://www.runoob.com:9000/'])expect(()=>readerUrl(url)).toThrow();
 });
 it('clamps a malformed viewport to the actual window, hiding empty areas',()=>{
  expect(readerBounds({x:200,y:100,width:900,height:500},800,600)).toEqual({x:200,y:100,width:600,height:500});
  expect(readerBounds({x:0,y:0,width:NaN,height:2},800,600)).toBeNull();
  expect(readerBounds({x:900,y:0,width:300,height:400},800,600)).toBeNull();
 });
 it('restores reading address without creating learning records or losing older backups',()=>{
  const s=emptyState(); const restored=validateState({...s,reading:{url:'https://www.runoob.com/python3/python3-loop.html',title:'循环'}});
  expect(cleanBackup(restored).reading.title).toBe('循环');expect(restored.columns).toHaveLength(0);expect(restored.sideChats).toHaveLength(0);
  expect(validateState({...s,reading:undefined}).reading.url).toBe('https://www.runoob.com/');
  expect(validateState({...s,reading:{url:'file:///etc/passwd',title:'bad'}}).reading.url).toBe('https://www.runoob.com/');
 });
 it('binds a chapter to its known course, and selection only carries the relevant paragraph',()=>{
  expect(readerCourse('https://www.runoob.com/python3/python3-loop.html','循环').url).toBe('https://www.runoob.com/python3/python3-tutorial.html');
  const d={url:'https://www.runoob.com/python3/python3-loop.html',title:'循环',version:'v',fetchedAt:'now',sections:[{id:'a',title:'while',blocks:[{kind:'paragraph' as const,text:'while 条件成立时重复执行。'},{kind:'paragraph' as const,text:'无关长段落'}]}]};
  const context=readerSelection(d.url,d.title,'条件成立',d);
  expect(context.sourceMessage).toContain('while 条件成立时重复执行。');expect(context.sourceMessage).not.toContain('无关长段落');
  expect(()=>readerSelection(d.url,d.title,'',d)).toThrow();
 });
 it('captures the already loaded chapter for cache-only full-article fallback',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'reader-'));let requests=0;
  try{const store=new TutorialStore(dir,{fetcher:async()=>{requests++;throw new Error('offline');}});
   const url='https://www.runoob.com/python3/python3-loop.html';
   expect(await store.cachedLesson(url)).toBeNull();
   await store.capture(url,'<div class="article-intro"><h1>循环</h1><p>概览</p><h2>while</h2><pre>while True:\n  break</pre><h2>for</h2><p>逐项遍历</p></div>');
   const restored=new TutorialStore(dir,{fetcher:async()=>{requests++;throw new Error('offline');}});
   expect((await restored.cachedLesson(url))?.sections.map(s=>s.title)).toEqual(['概览','while','for']);expect(requests).toBe(0);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
});
