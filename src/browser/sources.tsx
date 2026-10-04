import React, {useRef, useState} from 'react';
import catalog from '../data/runoob-catalog.json';
import type {CatalogCategory} from '../core/curriculum';
import {readerUrl} from '../core/reader';
import type {BrowserDocument} from '../core/browser-state';
import type {BrowserController} from './controller';
import {ReadButton} from './read-aloud';

const categories = catalog.categories as CatalogCategory[];

export function BrowserSources({document, controller, onDirty, suspended = false, onStage}: {document: BrowserDocument; controller: BrowserController; onDirty: (dirty: boolean) => void; suspended?: boolean; onStage?: (columnId: string, text: string) => Promise<void>}) {
  const [category, setCategory] = useState(categories[0].id);
  const [filter, setFilter] = useState('');
  const [url, setUrl] = useState(document.state.reading.url);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [staging, setStaging] = useState<{url:string;providedAt:string;excerpt:string;columnId:string}|null>(null);
  const held = useRef(suspended); held.current = suspended;
  const sourceDirty = useRef(false); const stagingDirty = useRef(false);
  function markSourceDirty(value: boolean) {sourceDirty.current=value;onDirty(sourceDirty.current||stagingDirty.current);}
  function markStagingDirty(value: boolean) {stagingDirty.current=value;onDirty(sourceDirty.current||stagingDirty.current);}
  const generation = useRef(0);
  const selected = categories.find(item => item.id === category)!;
  const courses = filter.trim() ? categories.flatMap(item => item.courses).filter(item => `${item.title} ${item.description}`.toLowerCase().includes(filter.trim().toLowerCase())) : selected.courses;
  async function saveReference() {
    if (held.current) return;
    const submitted = generation.current;
    try {
      const safeUrl = readerUrl(url);
      if (!text.trim()) throw Error('先粘贴你希望保留的原文片段。');
      if (text.length > 50000) throw Error('片段超过 50,000 字，请分成更小的片段。');
      await controller.change(latest => ({...latest, drafts: {...latest.drafts, references: {...latest.drafts.references, [safeUrl]: {url: safeUrl, text, providedAt: new Date().toISOString()}}}}));
      if (submitted === generation.current) markSourceDirty(false);
      setNotice('片段已保存在当前浏览器，尚未发送给模型。'); setError('');
    } catch (cause) {setError(cause instanceof Error ? cause.message : String(cause));}
  }
  return <section className="browser-page" aria-label="资料分类">
    <h1>资料</h1><p>在菜鸟教程原站阅读。回来后，可保留自己选取的片段。</p>
    <div className="browser-fields"><label>知识分类<select aria-label="知识分类" value={category} onChange={event => {if(!held.current)setCategory(event.target.value);}}>{categories.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label>查找课程<input type="search" value={filter} onChange={event => {if(!held.current)setFilter(event.target.value);}} placeholder="例如：Python、Java、SQL"/></label></div>
    <ul className="browser-courses">{courses.map(course => <li key={course.id}><a href={course.url} target="_blank" rel="noopener noreferrer" aria-disabled={suspended || undefined} tabIndex={suspended ? -1 : undefined} onClick={event => {if (suspended) {event.preventDefault(); return;} generation.current++; setUrl(course.url); if (text) markSourceDirty(true); void controller.change(latest => ({...latest, state: {...latest.state, reading: {url: readerUrl(course.url), title: course.title}}})).catch(cause => setError(String(cause)));}}><strong>{course.title}</strong><span>{course.description}</span><small>在原站打开 ↗</small></a></li>)}</ul>
    {!courses.length && <p className="browser-muted">没有匹配的课程，换一个关键词。</p>}
    <section className="browser-card"><h2>保留选取的片段</h2><p className="browser-muted">由你复制并提供，尚未核验原文版本。手机端不会读取另一个网页的内容或选区。</p>
      <label>原文地址<input aria-label="原文地址" value={url} onChange={event => {if(held.current)return;generation.current++; setUrl(event.target.value); markSourceDirty(!!text);}} type="url" autoCapitalize="off" autoCorrect="off"/></label>
      <label>选取的片段<textarea aria-label="选取的片段" rows={6} value={text} onChange={event => {if(held.current)return;if (event.target.value.length > 50000) {setError('片段超过 50,000 字，已保留原有内容。'); return;} generation.current++; setText(event.target.value); markSourceDirty(true);}} placeholder="从原站复制你想学习的段落。"/></label>
      <div className="browser-actions"><button onClick={() => void saveReference()}>保存参考片段</button><button onClick={() => {if(held.current)return;generation.current++; setText(''); setUrl(document.state.reading.url); markSourceDirty(false); setNotice('未保存的输入已放弃；已保存材料仍保留。');}}>放弃未保存片段</button></div>{error && <p role="alert" className="browser-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    </section>
    {!!Object.keys(document.drafts.references).length && <section><h2>已保留的材料</h2>{Object.entries(document.drafts.references).map(([key, reference]) => <details className="browser-card" key={key}><summary>你提供的材料 · {new Date(reference.providedAt).toLocaleDateString('zh-CN')}</summary><a href={reference.url} target="_blank" rel="noopener noreferrer" aria-disabled={suspended || undefined} tabIndex={suspended ? -1 : undefined} onClick={event => {if (suspended) event.preventDefault();}}>原站地址 ↗</a><p className="browser-reference">{reference.text}</p><ReadButton scope="sources" itemId={key} text={reference.text} label="朗读这份材料" source="你提供的材料，未核验原文版本" eligible={()=>!held.current}/>{onStage && <button onClick={()=>{if(held.current)return;setStaging({url:reference.url,providedAt:reference.providedAt,excerpt:"",columnId:document.state.activeColumnId??document.state.columns[0]?.id??""});markStagingDirty(true);}}>选取片段用于提问</button>}</details>)}</section>}
    {staging && <section className="browser-card"><h2>检查本次材料草稿</h2><p>你提供的材料，未核验原文版本。这里只加入草稿，发送前还需在教学页确认。</p><p>{staging.url} · {staging.providedAt}</p><label>目标栏目<select aria-label="材料目标栏目" value={staging.columnId} onChange={e=>{if(held.current)return;generation.current++;setStaging({...staging,columnId:e.target.value});markStagingDirty(true);}}><option value="">先创建本次栏目</option>{document.state.columns.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label><label>仅选取本次要讨论的片段<textarea aria-label="本次要发送的选取片段" value={staging.excerpt} onChange={e=>{if(held.current)return;if(e.target.value.length>50000){setError('选取片段超过 50,000 字，原输入仍保留。');return;}generation.current++;setStaging({...staging,excerpt:e.target.value});markStagingDirty(true);}}/></label><button onClick={()=>{if(held.current)return;const selected=staging;const submitted=generation.current;const payload=`用户提供的材料，未核验原文版本\n原文地址：${selected.url}\n提供时间：${selected.providedAt}\n本次选取：\n${selected.excerpt}`;if(!selected.excerpt.trim()){setError('先选取要讨论的片段。');return;}void onStage?.(selected.columnId,payload).then(()=>{if(submitted===generation.current){setStaging(null);markStagingDirty(false);}setError('');setNotice('材料已加入选定栏目草稿，请到可选 AI 教学检查后显式发送。');}).catch(cause=>setError(cause instanceof Error?cause.message:String(cause)));}}>确认加入材料草稿</button><button onClick={()=>{if(held.current)return;setStaging(null);markStagingDirty(false);}}>取消材料选取</button></section>}
  </section>;
}
