import React, {useEffect, useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import type {BrowserController} from './controller';
import {BrowserOnboarding} from './onboarding';
import {BrowserDataPanel} from './data-panel';
import {BrowserSources} from './sources';
import {registerBrowserPwa, type PwaController, type PwaStatus} from './pwa';
import {LabPanel} from '../renderer/lab-panel';
import {executeLab} from '../renderer/lab-client';
import {Icon} from '../renderer/icon';
import {practiceUnit} from '../data/practice-units';
import type {LabTask} from '../data/practice-units';
import type {LabRun} from '../core/lab';
import './app.css';

type Page = 'learn' | 'records' | 'sources' | 'settings';
const pages: Array<[Page, string, string]> = [['learn', '学习', 'book'], ['records', '记录', 'history'], ['sources', '资料', 'library'], ['settings', '设置', 'settings-gear']];
const storageLabels = {saved: '已保存到当前浏览器', saving: '正在保存…', unsaved: '尚未保存，内容仍保留在此页面', conflict: '另一页面已更新，待存内容保留在此页面', unavailable: '浏览器存储暂不可用，内容仍保留在此页面'};
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

export function BrowserApp({controller}: {controller: BrowserController}) {
  const [, render] = useState(0);
  const [page, setPage] = useState<Page>('learn');
  const [generation, setGeneration] = useState(0);
  const [sourceGeneration, setSourceGeneration] = useState(0);
  const [error, setError] = useState('');
  const [updateHeld, setUpdateHeld] = useState(false);
  const [canRefresh, setCanRefresh] = useState(false);
  const [pwaStatus, setPwaStatus] = useState<PwaStatus>({phase: 'not-ready', install: 'unsupported', message: '首次联网下载后可离线学习。'});
  const pwa = useRef<PwaController | null>(null);
  const running = useRef<AbortController | null>(null);
  const dirty = useRef<Record<string, boolean>>({});
  const updateHeldRef = useRef(false);
  const hasUiDraft = () => Object.values(dirty.current).some(Boolean);
  const document = controller.pendingDocument();
  useEffect(() => controller.subscribe(() => render(value => value + 1)), [controller]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {if (controller.hasPending() || controller.isBusy() || hasUiDraft()) {event.preventDefault(); event.returnValue = '';}};
    window.addEventListener('beforeunload', beforeUnload);
    return () => {window.removeEventListener('beforeunload', beforeUnload); running.current?.abort();};
  }, [controller]);
  useEffect(() => {
    let active = true; let unsubscribe: (() => void) | undefined;
    registerBrowserPwa(import.meta.env.BASE_URL, {
      flush: async () => {if (hasUiDraft()) throw Error('还有未保存的参考片段或导入预览。'); await controller.flush();},
      isBusy: () => controller.isBusy() && !updateHeldRef.current, hasPending: () => controller.hasPending() || hasUiDraft(),
      acquireUpdateLock: () => {
        if (hasUiDraft()) throw Error('先保存参考片段或取消导入预览。');
        const release = controller.acquireUpdateLock();
        updateHeldRef.current = true;
        flushSync(() => setUpdateHeld(true));
        return () => {updateHeldRef.current = false; release(); if (active) flushSync(() => setUpdateHeld(false));};
      }
    }).then(value => {if (!active) {value.dispose(); return;} pwa.current = value; setPwaStatus(value.status()); unsubscribe = value.subscribe(() => setPwaStatus(value.status()));}).catch(cause => {if (active) setError(message(cause));});
    return () => {active = false; unsubscribe?.(); pwa.current?.dispose(); pwa.current = null;};
  }, [controller]);
  function markDirty(scope: string, value: boolean) {dirty.current[scope] = value; render(previous => previous + 1);}
  function navigate(next: Page) {running.current?.abort(); setPage(next);}
  function remountLab() {running.current?.abort(); setGeneration(value => value + 1);}
  function remountLearning() {remountLab(); dirty.current = {}; setSourceGeneration(value => value + 1); render(value => value + 1);}
  async function execute(code: string, task: LabTask, signal?: AbortSignal): Promise<LabRun> {
    const abort = new AbortController(); running.current?.abort(); running.current = abort;
    const cancel = () => abort.abort(); signal?.addEventListener('abort', cancel, {once: true}); if (signal?.aborted) abort.abort();
    try {return await controller.withOperation('lab', () => executeLab(code, task, abort.signal));}
    finally {signal?.removeEventListener('abort', cancel); if (running.current === abort) running.current = null;}
  }
  async function start() {
    try {await controller.change(latest => ({...latest, state: {...latest.state, onboarding: {...latest.state.onboarding, introSeen: true}}})); setError('');}
    catch (cause) {setError(message(cause));}
  }
  async function update() {try {if (await pwa.current?.requestUpdate()) setCanRefresh(true);} catch (cause) {setError(message(cause));}}
  async function refresh() {try {if (hasUiDraft()) throw Error('还有未保存的内容。'); if (controller.isBusy()) throw Error('请等待当前操作结束。'); await controller.flush(); window.location.reload();} catch (cause) {setError(message(cause));}}
  const theme = document.state.settings.preferences.theme;
  const showIntro = !document.state.onboarding.introSeen && page !== 'settings';
  return <div className="browser-app" data-theme={theme}>
    <header className="browser-top"><strong><Icon name="book"/>学习工作台</strong><span>手机 / 浏览器版</span></header>
    <p className={`browser-save-state ${controller.storageStatus()}`} role="status">{updateHeld ? '正在安全更新，编辑暂时暂停。' : hasUiDraft() ? '有尚未保存的参考片段或导入预览' : storageLabels[controller.storageStatus()]}</p>
    {error && <p role="alert" className="browser-error browser-global-error">{error}</p>}
    <fieldset className="browser-interactive" disabled={updateHeld} inert={updateHeld} aria-disabled={updateHeld || undefined}>
      <nav className="browser-navigation" aria-label="主要导航">{pages.map(([id, label, icon]) => <button key={id} aria-current={page === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon name={icon}/>{label}</button>)}</nav>
      {showIntro && <BrowserOnboarding error={error} onStart={() => void start()} onImport={() => navigate('settings')}/>}
      <main>
        <div hidden={page !== 'learn' || showIntro}><LabPanel key={`lab:${generation}`} value={document.state.lab} drafts={document.drafts.lab} onChange={next => controller.change(latest => ({...latest, state: {...latest.state, lab: next}})).then(() => {})} onDraftChange={(key, next) => controller.change(latest => ({...latest, drafts: {...latest.drafts, lab: {...latest.drafts.lab, [key]: next}}})).then(() => {})} execute={execute}/></div>
        <section hidden={page !== 'records' || showIntro} className="browser-page" aria-label="学习记录"><h1>学习记录</h1><p>看自己的代码、解释和实际结果。打卡与阅读次数不表示掌握。</p>
          {document.state.lab.attempts.map(attempt => <details className="browser-card" key={attempt.id}><summary>{practiceUnit(attempt.unitId).title} · {attempt.passed ? '当前用例通过' : '本次未通过'}</summary><p>{new Date(attempt.createdAt).toLocaleString('zh-CN')} · {({independent: '独立尝试', hinted: '看过提示', explained: '看过讲解'})[attempt.helpLevel]}</p><pre><code>{attempt.code}</code></pre><p className="browser-reference">{attempt.explanation}</p></details>)}
          {!document.state.lab.attempts.length && <p className="browser-muted">还没有保存实践产出。先读一个例子，再完成一次自己的尝试。</p>}
          {!!document.state.columns.length && <h2>导入的学习栏目</h2>}{document.state.columns.map(column => <details className="browser-card" key={column.id}><summary>{column.title}</summary><p>{column.goal}</p>{column.messages.map(item => <div className="browser-record-message" key={item.id}><strong>{item.role === 'user' ? '你的回答' : '助手内容'}</strong><p className="browser-reference">{item.content}</p></div>)}{!!column.evidence.length && <p>原始证据 {column.evidence.length} 条，等级和原文保留在完整备份。</p>}</details>)}
          {!!document.state.checkins.length && <h2>已有打卡</h2>}{document.state.checkins.map((item, index) => <p key={index}>{item.date} · {item.note}</p>)}
        </section>
        <div hidden={page !== 'sources' || showIntro}><BrowserSources key={`sources:${sourceGeneration}`} document={document} controller={controller} suspended={updateHeld} onDirty={value => markDirty('sources', value)}/></div>
        <section hidden={page !== 'settings'} className="browser-page" aria-label="浏览器设置"><h1>设置</h1>
          <section className="browser-card"><h2>外观</h2><div className="browser-actions">{(['system', 'light', 'dark'] as const).map(value => <button key={value} aria-pressed={theme === value} onClick={() => void controller.change(latest => ({...latest, state: {...latest.state, settings: {...latest.state.settings, preferences: {...latest.state.settings.preferences, theme: value}}}})).catch(cause => setError(message(cause)))}>{({system: '跟随系统', light: '浅色', dark: '深色'})[value]}</button>)}</div><button onClick={() => {navigate('learn'); void controller.change(latest => ({...latest, state: {...latest.state, onboarding: {...latest.state.onboarding, introSeen: false}}})).catch(cause => setError(message(cause)));}}>查看简短介绍</button></section>
          <BrowserDataPanel controller={controller} onRestored={remountLearning} onRetrySaved={remountLab} onDirty={value => markDirty('import', value)} hasUnsavedReference={() => dirty.current.sources === true}/>
          <section className="browser-card"><h2>安装与离线</h2><p>{pwaStatus.message}</p>{pwaStatus.install !== 'unsupported' && <button onClick={() => void pwa.current?.install()}>{pwaStatus.install === 'prompt' ? '安装到主屏幕' : pwaStatus.install === 'installed' ? '查看安装说明' : '如何添加到主屏幕'}</button>}{pwaStatus.phase === 'update-waiting' && <button onClick={() => void update()}>保存并更新</button>}</section>
          <section className="browser-card"><h2>项目、模型与系统功能</h2><p>Docker 副本、文件编辑和本机项目运行目前在桌面端使用。手机无法直接访问电脑的 localhost。</p><p>手机模型教学、语音与关闭网页后的系统提醒继续开发中。本版先提供真实离线练习与资料入口。</p><a href="https://github.com/wondercloud-me/learning-workbench" target="_blank" rel="noopener noreferrer">桌面源码与平台进展 ↗</a></section>
        </section>
      </main>
    </fieldset>
    {canRefresh && <div className="browser-update"><p>新版本已准备好。</p><button onClick={() => void refresh()}>保存并刷新新版本</button></div>}
    <footer className="browser-footer">{pwaStatus.phase === 'offline-ready' ? '离线资源已就绪' : '首次使用需要联网下载离线资源'} · 0.9.0 浏览器首版</footer>
  </div>;
}
