import React,{useEffect,useState} from 'react';
import catalog from '../data/runoob-catalog.json';
import type {Course,CourseDirectory,LessonDocument,MaterialBlock,TutorialStats} from '../core/curriculum';
import type {AppState} from '../core/state';
import type {LearningColumn} from '../core/learning';
import {Icon} from './shell';
import './course-home.css';
export function CourseHome({state,busy,onOpenLesson,onResume}:{state:AppState;busy:boolean;onOpenLesson:(course:Course,url:string)=>Promise<void>;onResume:(column:LearningColumn)=>void}){
 const [categoryId,setCategoryId]=useState<string|null>(null),[course,setCourse]=useState<Course|null>(null),[directory,setDirectory]=useState<CourseDirectory|null>(null);
 const [refresh,setRefresh]=useState(0);
 const [query,setQuery]=useState(''),[reading,setReading]=useState(false),[error,setError]=useState('');
 const category=catalog.categories.find(c=>c.id===categoryId);
 useEffect(()=>{if(!course){setDirectory(null);return;}let current=true;setReading(true);setError('');setDirectory(null);window.workbench.tutorialCourse(course.url,refresh>0).then(data=>{if(current)setDirectory(data);}).catch(e=>{if(current)setError(String(e));}).finally(()=>{if(current)setReading(false);});return()=>{current=false;};},[course,refresh]);
 const search=query.trim().toLowerCase();
 const courses=search?catalog.categories.flatMap(c=>c.courses).filter(c=>`${c.title} ${c.description}`.toLowerCase().includes(search)):category?.courses||[];
 const recent=[...state.columns].reverse().filter(c=>c.source&&c.phase!=='complete').slice(0,3);
 const choose=(c:Course)=>{setQuery('');setRefresh(0);setCourse(c);};
 return <section className="course-home">
  <nav className="course-breadcrumb" aria-label="课程位置"><button onClick={()=>{setCategoryId(null);setCourse(null);setQuery('');}}><Icon name="home"/>首页</button>{category&&<><Icon name="chevron-right"/><button onClick={()=>setCourse(null)}>{category.title}</button></>}{course&&<><Icon name="chevron-right"/><span>{course.title}</span></>}</nav>
  {!course&&<label className="course-search"><Icon name="search"/><input aria-label="搜索课程" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索课程，例如 Python、Git、后端"/></label>}
  {!course&&!category&&!search&&<>
   <div className="course-heading"><small>从知道，到能做</small><h2>选择一个方向，开始一小节</h2><p>选分类 → 选课程 → 选知识点 → 跟着 AI 学。<br/>先讲清、跑一个例子，再用自己的话复述。</p></div>
   {!!recent.length&&<section className="course-recent"><h3>继续学习</h3>{recent.map(c=><button key={c.id} disabled={busy} onClick={()=>onResume(c)}><Icon name="history"/><span><strong>{c.title}</strong><small>{c.plan?.steps[c.currentStepIndex]?.title} · {c.plan?.steps.filter(s=>s.status==='已完成').length}/{c.plan?.steps.length} 小节完成</small></span><Icon name="arrow-right"/></button>)}</section>}
   <div className="category-grid">{catalog.categories.map((c,i)=><button className="category-card" key={c.id} onClick={()=>setCategoryId(c.id)}><Icon name={['symbol-method','sparkle','browser','server','database','device-mobile','tools','code','symbol-structure','globe','extensions','window'][i]||'book'}/><h3>{c.title}</h3><p>{c.description}</p><small>{c.courses.length} 门课程<Icon name="arrow-right"/></small></button>)}</div>
  </>}
  {!course&&(category||search)&&<><div className="course-heading"><h2>{search?`搜索“${query}”`:category?.title}</h2><p>{search?`${courses.length} 门课程。浏览目录无需模型。`:category?.description}</p></div><div className="course-grid">{courses.map((c,i)=><button className="course-card" key={`${c.id}:${i}`} onClick={()=>choose(c)}><Icon name="book"/><span><strong>{c.title}</strong><small>{c.description||'打开查看知识点目录'}</small></span><Icon name="chevron-right"/></button>)}</div>{!courses.length&&<p>没有匹配的课程，试试 Python、Java 或 Git。</p>}</>}
  {course&&<><div className="course-heading"><small>菜鸟教程 · 课程目录</small><h2>{course.title}</h2><p>{course.description}</p><div className="button-row"><button onClick={()=>void window.workbench.tutorialExternal(course.url).catch(e=>setError(String(e)))}><Icon name="link-external"/>查看来源</button><button disabled={reading} onClick={()=>setRefresh(n=>n+1)}><Icon name="refresh"/>刷新目录</button></div></div>
   <p className="course-note">点选一个知识点后读取正文。AI 根据当前小节讲解，首次阅读不测试水平。</p>
   {reading&&<p role="status">正在读取章节目录…</p>}{error&&<div className="course-error" role="alert">{error}<p>本次读取失败，没有生成 AI 教案。可刷新或打开原教程。</p></div>}
   {directory&&<div className="chapter-list">{directory.chapters.map((chapter,i)=>{const column=state.columns.find(c=>c.source?.url===chapter.url);return <button key={chapter.url} disabled={busy} onClick={()=>void onOpenLesson(course,chapter.url)}><span className="chapter-number">{i+1}</span><span><strong>{chapter.title}</strong><small>{column?`${column.phase==='complete'?'本章完成':'学习中'} · ${column.plan?.steps.filter(s=>s.status==='已完成').length}/${column.plan?.steps.length} 小节`:'未开始'}</small></span><Icon name={column?'history':'arrow-right'}/></button>;})}</div>}
  </>}
  <footer className="course-source">目录来自菜鸟教程 · 点击章节按需读取 · 本机缓存上限 50 MiB。学习记录独立保存。<button onClick={()=>void window.workbench.tutorialExternal(catalog.source).catch(e=>setError(String(e)))}>原站</button></footer>
 </section>;
}
export function MaterialContent({blocks}:{blocks:MaterialBlock[]}){
 const [images,setImages]=useState<string[]>([]);
 return <div className="material-blocks">{blocks.map((block,i)=>block.kind==='code'?<pre key={i}><code>{block.text}</code></pre>:block.kind==='paragraph'?<p key={i}>{block.text}</p>:block.kind==='table'?<div className="material-table" key={i}><table><tbody>{block.rows.map((row,r)=><tr key={r}>{row.map((cell,c)=><td key={c}>{cell}</td>)}</tr>)}</tbody></table></div>:block.kind==='image'?<div key={i} className="material-image">{images.includes(block.url)?<img alt={block.alt} src={block.url} referrerPolicy="no-referrer"/>:<button onClick={()=>setImages(old=>[...old,block.url])}><Icon name="file-media"/>加载配图：{block.alt}</button>}</div>:<button key={i} onClick={()=>void window.workbench.tutorialExternal(block.url)}><Icon name="link-external"/>{block.title}</button>)}</div>;
}
export function LessonPanel({column,onError}:{column:LearningColumn;onError:(s:string)=>void}){
 const [document,setDocument]=useState<LessonDocument|null>(null),[error,setError]=useState(''),[pinned,setPinned]=useState(false),[reading,setReading]=useState(true),[view,setView]=useState(column.currentStepIndex);
 const source=column.source!;
 useEffect(()=>{let current=true;setDocument(null);setError('');setReading(true);Promise.all([window.workbench.tutorialLesson(source.url),window.workbench.tutorialPinned(source.url)]).then(([doc,pin])=>{if(!current)return;if(doc.version!==source.version)throw new Error('原教程已变化，请从首页打开新版本。旧学习记录保留。');setDocument(doc);setPinned(pin);}).catch(e=>{if(current)setError(String(e));}).finally(()=>{if(current)setReading(false);});return()=>{current=false;};},[source.url,source.version]);
 useEffect(()=>setView(Math.min(column.currentStepIndex,source.sectionIds.length-1)),[column.currentStepIndex,source.sectionIds.length]);
 const section=document?.sections[view];
 return <section className="lesson-panel"><header><small>原文材料 · {source.course.title}</small><h2>{document?.title||column.title}</h2><div className="button-row"><button onClick={()=>void window.workbench.tutorialExternal(source.url).catch(e=>onError(String(e)))}><Icon name="link-external"/>原教程</button><button disabled={!document} aria-pressed={pinned} onClick={()=>void window.workbench.tutorialPin(source.url,!pinned).then(()=>setPinned(!pinned)).catch(e=>onError(String(e)))}><Icon name={pinned?'pinned':'pin'}/>{pinned?'已固定离线':'固定离线'}</button></div><p>只读教材。选择小节仅切换阅读位置，不改变学习进度。</p></header>
 {reading&&<p role="status">读取正文…</p>}{error&&<div role="alert" className="course-error">{error}<button onClick={()=>void window.workbench.tutorialLesson(source.url).then(doc=>{if(doc.version!==source.version)throw new Error('原教程已变化，请回首页打开新版本');setDocument(doc);setError('');}).catch(e=>setError(String(e)))}>重试读取</button></div>}
 {document&&<><nav className="lesson-sections" aria-label="原文章节小节">{document.sections.map((s,i)=><button key={s.id} aria-current={i===view?'true':undefined} onClick={()=>setView(i)}>{i+1} · {s.title}{i===column.currentStepIndex?' · 当前学习':''}<small>{column.plan?.steps[i]?.status}</small></button>)}</nav>{section&&<article key={section.id}><small>{view===column.currentStepIndex?'AI 当前教这一小节':'正在阅读；AI 教学仍在当前进度'}</small><h2>{section.title}</h2><MaterialContent blocks={section.blocks}/></article>}<footer>来源：菜鸟教程 · 缓存时间 {new Date(document.fetchedAt).toLocaleString()}<br/>代码、表格保留原文；图片点击后联网加载。</footer></>}
 </section>;
}
export function TutorialCacheSettings(){
 const [stats,setStats]=useState<TutorialStats|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{void window.workbench.tutorialStats().then(setStats).catch(e=>setError(String(e)));},[]);
 const clear=async(includePinned:boolean)=>{setBusy(true);try{setStats(await window.workbench.tutorialClear(includePinned));setError('');}catch(e){setError(String(e));}finally{setBusy(false);}};
 return <section className="tutorial-cache-settings"><h3>教程缓存</h3><p>{stats?`${(stats.bytes/1024/1024).toFixed(2)} / ${(stats.budget/1024/1024).toFixed(0)} MiB · ${stats.entries} 项 · ${stats.pinned} 章固定离线`:'正在读取缓存用量…'}</p><p>满额时清理最久未用的未固定材料。回答、代码、笔记与学习进度不受影响；备份不含可重新获取的教程正文。</p><div className="button-row"><button disabled={busy} onClick={()=>void clear(false)}>清理未固定缓存</button><button disabled={busy} onClick={()=>void clear(true)}>清理全部教材缓存（含固定）</button></div>{error&&<p role="alert">{error}</p>}</section>;
}
