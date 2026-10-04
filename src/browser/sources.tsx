import React, {useRef, useState} from 'react';
import catalog from '../data/runoob-catalog.json';
import type {CatalogCategory} from '../core/curriculum';
import {readerUrl} from '../core/reader';
import type {BrowserDocument} from '../core/browser-state';
import type {BrowserController} from './controller';

const categories = catalog.categories as CatalogCategory[];

export function BrowserSources({document, controller, onDirty, suspended = false}: {document: BrowserDocument; controller: BrowserController; onDirty: (dirty: boolean) => void; suspended?: boolean}) {
  const [category, setCategory] = useState(categories[0].id);
  const [filter, setFilter] = useState('');
  const [url, setUrl] = useState(document.state.reading.url);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const selected = categories.find(item => item.id === category)!;
  const courses = filter.trim() ? categories.flatMap(item => item.courses).filter(item => `${item.title} ${item.description}`.toLowerCase().includes(filter.trim().toLowerCase())) : selected.courses;
  async function saveReference() {
    const submitted = generation.current;
    try {
      const safeUrl = readerUrl(url);
      if (!text.trim()) throw Error('先粘贴你希望保留的原文片段。');
      if (text.length > 50000) throw Error('片段超过 50,000 字，请分成更小的片段。');
      await controller.change(latest => ({...latest, drafts: {...latest.drafts, references: {...latest.drafts.references, [safeUrl]: {url: safeUrl, text, providedAt: new Date().toISOString()}}}}));
      if (submitted === generation.current) onDirty(false);
      setNotice('片段已保存在当前浏览器，尚未发送给模型。'); setError('');
    } catch (cause) {setError(cause instanceof Error ? cause.message : String(cause));}
  }
  return <section className="browser-page" aria-label="资料分类">
    <h1>资料</h1><p>在菜鸟教程原站阅读。回来后，可保留自己选取的片段。</p>
    <div className="browser-fields"><label>知识分类<select aria-label="知识分类" value={category} onChange={event => setCategory(event.target.value)}>{categories.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label>查找课程<input type="search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="例如：Python、Java、SQL"/></label></div>
    <ul className="browser-courses">{courses.map(course => <li key={course.id}><a href={course.url} target="_blank" rel="noopener noreferrer" aria-disabled={suspended || undefined} tabIndex={suspended ? -1 : undefined} onClick={event => {if (suspended) {event.preventDefault(); return;} generation.current++; setUrl(course.url); if (text) onDirty(true); void controller.change(latest => ({...latest, state: {...latest.state, reading: {url: readerUrl(course.url), title: course.title}}})).catch(cause => setError(String(cause)));}}><strong>{course.title}</strong><span>{course.description}</span><small>在原站打开 ↗</small></a></li>)}</ul>
    {!courses.length && <p className="browser-muted">没有匹配的课程，换一个关键词。</p>}
    <section className="browser-card"><h2>保留选取的片段</h2><p className="browser-muted">由你复制并提供，尚未核验原文版本。手机端不会读取另一个网页的内容或选区。</p>
      <label>原文地址<input aria-label="原文地址" value={url} onChange={event => {generation.current++; setUrl(event.target.value); onDirty(!!text);}} type="url" autoCapitalize="off" autoCorrect="off"/></label>
      <label>选取的片段<textarea aria-label="选取的片段" rows={6} value={text} onChange={event => {if (event.target.value.length > 50000) {setError('片段超过 50,000 字，已保留原有内容。'); return;} generation.current++; setText(event.target.value); onDirty(true);}} placeholder="从原站复制你想学习的段落。"/></label>
      <div className="browser-actions"><button onClick={() => void saveReference()}>保存参考片段</button><button onClick={() => {generation.current++; setText(''); setUrl(document.state.reading.url); onDirty(false); setNotice('未保存的输入已放弃；已保存材料仍保留。');}}>放弃未保存片段</button></div>{error && <p role="alert" className="browser-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    </section>
    {!!Object.keys(document.drafts.references).length && <section><h2>已保留的材料</h2>{Object.entries(document.drafts.references).map(([key, reference]) => <details className="browser-card" key={key}><summary>你提供的材料 · {new Date(reference.providedAt).toLocaleDateString('zh-CN')}</summary><a href={reference.url} target="_blank" rel="noopener noreferrer" aria-disabled={suspended || undefined} tabIndex={suspended ? -1 : undefined} onClick={event => {if (suspended) event.preventDefault();}}>原站地址 ↗</a><p className="browser-reference">{reference.text}</p></details>)}</section>}
  </section>;
}
