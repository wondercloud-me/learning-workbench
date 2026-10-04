import React, {useEffect, useRef, useState} from 'react';
import {createBackup, readBackup} from '../core/backup';
import type {BrowserDocument, BrowserSnapshot} from '../core/browser-state';
import {openBrowserRecovery, type BrowserRecovery, type BrowserRecoveryInspection} from './repository';

const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
const message = (cause: unknown) => cause instanceof Error ? cause.message : '浏览器存储暂时不可用。';
const counts = (value: BrowserDocument) => `${value.state.columns.length} 栏目 · ${value.state.sideChats.length} 侧聊 · ${value.state.lab.attempts.length} 次实践 · ${value.state.checkins.length} 次打卡`;
function downloadLocal(data: string, name: string) {
  const url = URL.createObjectURL(new Blob([data], {type: 'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function StartupRecovery({cause, onRetry, openRecovery = openBrowserRecovery, download = downloadLocal}: {cause: unknown; onRetry: () => void; openRecovery?: () => Promise<BrowserRecovery>; download?: (data: string, name: string) => void}) {
  const [inspection, setInspection] = useState<BrowserRecoveryInspection | null>(null);
  const [incoming, setIncoming] = useState<BrowserDocument | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const port = useRef<BrowserRecovery | null>(null);
  const active = useRef(false);
  const operation = useRef(false);
  const fileGeneration = useRef(0);
  useEffect(() => {
    let live = true; active.current = true;
    void openRecovery().then(async value => {
      if (!live) {value.close(); return;}
      port.current = value;
      try {const result = await value.inspect(); if (live) setInspection(result);}
      catch (cause) {if (live) setError(message(cause));}
    }).catch(cause => {if (live) setError(message(cause));});
    return () => {live = false; active.current = false; fileGeneration.current++; port.current?.close(); port.current = null;};
  }, [openRecovery]);

  async function chooseFile(file: File | undefined) {
    if (!file || operation.current || !inspection?.canRepair) return;
    const generation = ++fileGeneration.current;
    setIncoming(null); setError(''); setNotice('');
    if (file.size > MAX_BACKUP_BYTES) {setError('备份超过 50 MiB，原始记录保持原样。'); return;}
    try {
      const text = await file.text();
      if (!active.current || generation !== fileGeneration.current) return;
      if (new Blob([text]).size > MAX_BACKUP_BYTES) throw new Error('备份超过 50 MiB');
      setIncoming(readBackup(JSON.parse(text)));
    } catch (cause) {if (active.current && generation === fileGeneration.current) setError(`未恢复：${message(cause)}。原始记录保持原样。`);}
  }
  async function restore() {
    if (operation.current || !incoming || !inspection?.canRepair || !port.current) return;
    operation.current = true; setBusy(true); setError('');
    try {
      await port.current.repair(incoming, inspection.token);
      port.current.close(); port.current = null;
      if (active.current) onRetry();
    } catch (cause) {if (active.current) setError(`未恢复：${message(cause)}。原始记录保持原样。`);}
    finally {operation.current = false; if (active.current) setBusy(false);}
  }
  async function archive() {
    if (!port.current || !inspection?.canArchive || operation.current) return;
    try {
      const data = await port.current.rawArchive(inspection.token);
      download(data, '学习工作台-原始存证-仅本地保管.json');
      setNotice('原始存证已交给浏览器下载。请检查文件位置，仅在本地保管。'); setError('');
    } catch (cause) {if (active.current) setError(message(cause));}
  }
  function snapshotBackup(snapshot: BrowserSnapshot) {
    try {
      download(JSON.stringify(createBackup(snapshot.document, '0.9.0', new Date().toISOString()), null, 2), `学习工作台-恢复快照-${snapshot.revision}.json`);
      setNotice('快照备份已交给浏览器下载。请检查文件保存位置。'); setError('');
    } catch (cause) {setError(message(cause));}
  }
  function retry() {
    if (operation.current) return;
    fileGeneration.current++; port.current?.close(); port.current = null; onRetry();
  }
  const future = inspection?.kind === 'future';
  return <main className="browser-start">
    <h1>暂时无法打开学习记录</h1><p>{message(cause)}</p>
    <p>当前记录已保留。恢复入口不会清空或删除数据库。</p>
    {!inspection && !error && <p role="status">正在只读检查原始记录与恢复快照…</p>}
    {future && <div className="browser-warning"><p>这是未来版本的数据（数据库版本 {inspection.databaseVersion}）。请在同一浏览器和网站使用较新的工作台打开，再导出完整备份。当前版本只读，无法导入或修复。</p></div>}
    {inspection?.kind === 'valid' && <p>当前记录已通过校验，请重试读取。有效记录不能通过此入口替换。</p>}
    {(inspection?.kind === 'unrecognized' || (inspection?.kind === 'invalid' && !inspection.canRepair)) && <p>无法安全识别或比较原始数据，已停用修复。请保留网站数据并在本地检查。</p>}
    <p className="browser-muted">本地检查可使用浏览器开发者工具的存储 / IndexedDB 面板；手机可连接电脑检查。请勿清除网站数据。未知版本的数据库请交由较新的工作台读取。</p>
    {inspection?.canArchive && <section className="browser-warning" aria-label="原始记录存证">
      <h2>原始记录存证</h2><p>存证含检查时的原始记录，未经清理，可能含敏感信息。它是本地排查档案，不能作为普通备份导入；请仅在本地保管，不要上传或分享。</p>
      <button disabled={busy} onClick={() => void archive()}>下载原始记录存证（仅本地保管）</button>
    </section>}
    {inspection?.canRepair && <section aria-label="启动恢复">
      <h2>恢复损坏的学习记录</h2><p>选择不超过 50 MiB 的支持版本备份，或预览下面的恢复快照。确认后修复当前记录，原始记录同时保留在本地存证中；任何一步失败都会取消整个修复。</p>
      <label>选择恢复备份<input aria-label="选择恢复备份" type="file" accept=".json,application/json" disabled={busy} onChange={event => {const file = event.target.files?.[0]; event.target.value = ''; void chooseFile(file);}}/></label>
    </section>}
    {!!inspection?.recoveries.length && <section aria-label="可用恢复快照"><h2>可用恢复快照</h2>{inspection.recoveries.map(snapshot => <div key={`${snapshot.revision}:${snapshot.updatedAt}`}>
      <p>{new Date(snapshot.updatedAt).toLocaleString('zh-CN')} · {counts(snapshot.document)}</p>
      {inspection.canRepair && <button disabled={busy} onClick={() => {fileGeneration.current++; setIncoming(snapshot.document); setError(''); setNotice('');}}>预览此恢复快照</button>}
      <button disabled={busy} onClick={() => snapshotBackup(snapshot)}>下载此快照备份</button>
    </div>)}</section>}
    {incoming && inspection?.canRepair && <section className="browser-import-preview" aria-label="恢复预览"><h2>恢复预览</h2><p>{counts(incoming)}</p><p>将以以上完整备份替换损坏的当前记录，包含学习记录与手机草稿。原始损坏记录保留在本地存证中。配置的模型 Key 需要重新提供。</p>
      <button disabled={busy} onClick={() => void restore()}>确认修复并恢复</button><button disabled={busy} onClick={() => {fileGeneration.current++; setIncoming(null); setError('');}}>取消恢复</button>
    </section>}
    {error && <p role="alert" className="browser-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <button disabled={busy} onClick={retry}>重试读取</button><a href="https://github.com/wondercloud-me/learning-workbench" target="_blank" rel="noopener noreferrer">查看使用说明 ↗</a>
  </main>;
}
