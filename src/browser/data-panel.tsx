import React, {useEffect, useState} from 'react';
import {createBackup, readBackup} from '../core/backup';
import {cleanBackup} from '../core/state';
import type {BrowserDocument, BrowserSnapshot} from '../core/browser-state';
import type {BrowserController} from './controller';

export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const counts = (document: BrowserDocument) => `${document.state.columns.length} 栏目 · ${document.state.sideChats.length} 侧聊 · ${document.state.lab.attempts.length} 次实践 · ${document.state.checkins.length} 次打卡`;

export function BrowserDataPanel({controller, onRestored, onRetrySaved, onDirty, hasUnsavedReference}: {controller: BrowserController; onRestored: () => void; onRetrySaved: () => void; onDirty: (dirty: boolean) => void; hasUnsavedReference: () => boolean}) {
  const [incoming, setIncoming] = useState<BrowserDocument | null>(null);
  const [recoveries, setRecoveries] = useState<BrowserSnapshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [estimate, setEstimate] = useState('');
  const [persistent, setPersistent] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    controller.recoveries().then(value => {if (active) setRecoveries(value);}).catch(cause => {if (active) setError(message(cause));});
    navigator.storage?.estimate?.().then(value => {if (active) setEstimate(`约 ${((value.usage || 0) / 1048576).toFixed(1)} MiB / ${(value.quota || 0) ? ((value.quota || 0) / 1048576).toFixed(0) + ' MiB 可用额度' : '额度未提供'}`);}).catch(() => {});
    navigator.storage?.persisted?.().then(value => {if (active) setPersistent(value);}).catch(() => {});
    return () => {active = false;};
  }, [controller]);

  function backupFile(compatible = false) {
    const document = controller.pendingDocument();
    const data = compatible ? cleanBackup(document.state) : createBackup(document, '0.9.0', new Date().toISOString());
    return new File([JSON.stringify(data, null, 2)], `学习工作台${compatible ? '-旧桌面' : ''}-${new Date().toLocaleDateString('sv-SE')}.json`, {type: 'application/json'});
  }
  function download(compatible = false) {
    try {
      const file = backupFile(compatible);
      const url = URL.createObjectURL(file);
      const link = document.createElement('a'); link.href = url; link.download = file.name; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setNotice('备份已生成并交给浏览器下载。请检查文件保存位置。'); setError('');
    } catch (cause) {setError(message(cause));}
  }
  async function share() {
    try {
      const file = backupFile();
      if (!navigator.canShare?.({files: [file]})) throw Error('当前浏览器不支持文件分享，请使用下载备份。');
      await navigator.share({files: [file], title: '学习工作台备份'});
      setNotice('备份已交给系统分享，请检查是否已存入文件。'); setError('');
    } catch (cause) {if ((cause as {name?: string})?.name !== 'AbortError') setError(message(cause));}
  }
  async function importFile(file: File | undefined) {
    if (!file) return;
    setIncoming(null); setNotice('');
    onDirty(true);
    if (file.size > MAX_BACKUP_BYTES) {setError('备份超过 50 MiB，当前数据保持原样。'); onDirty(false); return;}
    try {setIncoming(readBackup(JSON.parse(await file.text()))); setError('');}
    catch (cause) {setError(`未导入：${message(cause)}。当前数据保持原样。`); onDirty(false);}
  }
  async function replace(next: BrowserDocument) {
    if (hasUnsavedReference()) {setError('资料页还有未保存的片段，请先保存或放弃片段，再恢复备份。'); return;}
    if (busy) return; setBusy(true); setError('');
    try {await controller.replace(next); setIncoming(null); onDirty(false); onRestored(); setNotice('备份已恢复。替换前的记录保留在恢复快照中。'); controller.recoveries().then(setRecoveries).catch(cause => setError(message(cause)));}
    catch (cause) {setError(message(cause));}
    finally {setBusy(false);}
  }
  async function retry() {
    try {await controller.change(value => value); await controller.flush(); onRetrySaved(); setNotice('待存内容已保存。'); setError('');}
    catch (cause) {setError(message(cause));}
  }
  async function reloadLatest() {
    if (busy) return;
    setBusy(true);
    try {await controller.reloadLatest(); onRestored(); setNotice('已读取其他页面保存的最新记录。'); setError('');}
    catch (cause) {setError(message(cause));}
    finally {setBusy(false);}
  }
  async function requestPersistence() {
    try {if (!navigator.storage?.persist) throw Error('当前浏览器没有持久存储请求接口。'); setPersistent(await navigator.storage.persist());}
    catch (cause) {setError(message(cause));}
  }
  const status = controller.storageStatus();
  return <section className="browser-card" aria-label="数据与备份">
    <h2>数据与备份</h2><p>{counts(controller.pendingDocument())}</p>
    <p className="browser-muted">记录存于当前浏览器。清理网站数据或浏览器回收存储会影响记录，请另存备份；手机与电脑可通过备份迁移。</p>
    <div className="browser-actions"><button onClick={() => download()}>{controller.hasPending() ? '导出待存备份' : '下载完整备份'}</button><button onClick={() => download(true)}>兼容旧桌面备份</button>{typeof navigator.share === 'function' && <button onClick={() => void share()}>分享备份文件</button>}</div>
    <p className="browser-muted">完整备份含手机草稿；旧桌面备份只含学习记录，不含未发送草稿。配置的 API Key 不进入备份。</p>
    {status === 'unsaved' && <button onClick={() => void retry()}>重试保存待存内容</button>}
    {(status === 'conflict' || status === 'unsaved') && <div className="browser-warning"><p>{status === 'conflict' ? '另一个页面已更新。' : '当前内容还未保存。'}先导出待存备份，再选择读取最新记录；读取会放弃此页面尚未保存的内容。请先保存或明确放弃待存内容，再恢复其他备份。</p><button disabled={busy || controller.isBusy()} onClick={() => void reloadLatest()}>放弃待存内容，读取最新记录</button></div>}
    <label className="browser-import">选择备份文件<input aria-label="选择备份文件" type="file" accept=".json,application/json" onChange={event => {const file = event.target.files?.[0]; event.target.value = ''; void importFile(file);}}/></label>
    {incoming && <div className="browser-import-preview"><h3>导入预览</h3><p>{counts(incoming)}</p><p>确认后替换当前记录。替换前自动保留一个恢复快照；当前模型 Key 需要重新提供。</p><div className="browser-actions"><button disabled={busy || controller.isBusy()} onClick={() => void replace(incoming)}>确认恢复备份</button><button disabled={busy} onClick={() => {setIncoming(null); onDirty(false);}}>取消导入</button></div></div>}
    {!!recoveries.length && <details><summary>替换前的恢复快照（{recoveries.length}）</summary>{recoveries.map(item => <div className="browser-recovery" key={`${item.revision}:${item.updatedAt}`}><p>{new Date(item.updatedAt).toLocaleString('zh-CN')} · {counts(item.document)}</p><button disabled={busy || controller.isBusy()} onClick={() => {setIncoming(item.document); onDirty(true); setNotice('请检查上方导入预览后确认恢复。');}}>预览此快照</button></div>)}</details>}
    <section className="browser-storage"><h3>浏览器存储</h3>{estimate && <p>{estimate}</p>}<p>{persistent === true ? '浏览器已授予持久存储。仍建议另存备份。' : persistent === false ? '浏览器尚未授予持久存储。' : '当前持久存储状态未提供。'}</p><button onClick={() => void requestPersistence()}>请求持久保存</button></section>
    {error && <p role="alert" className="browser-error">{error}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
}
