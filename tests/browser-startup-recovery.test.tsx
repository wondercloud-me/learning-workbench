// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, expect, it} from 'vitest';
import {IDBFactory} from 'fake-indexeddb';
import {openBrowserRecovery, openBrowserRepository} from '../src/browser/repository';
import {StartupRecovery} from '../src/browser/startup-recovery';
import {emptyBrowserDocument} from '../src/core/browser-state';
import {createBackup} from '../src/core/backup';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const now = '2026-10-05T10:00:00.000Z';
const corrupt = {schemaVersion: 1, revision: 2, document: {retain: 'raw-original'}};
const mounted: Array<{host: HTMLDivElement; root: Root}> = [];
afterEach(async () => {for (const {host, root} of mounted.splice(0)) {await act(async () => root.unmount()); host.remove();}});
function completion(tx: IDBTransaction) {return new Promise<void>((resolve, reject) => {tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);});}
async function rawOpen(factory: IDBFactory) {const request = factory.open('growth-workbench'); return new Promise<IDBDatabase>(resolve => {request.onsuccess = () => resolve(request.result);});}
async function fixture(value: unknown = corrupt) {
  const factory = new IDBFactory(); const repository = await openBrowserRepository(factory, () => now); repository.close();
  const db = await rawOpen(factory); const tx = db.transaction(['document', 'recovery'], 'readwrite');
  const recovered = emptyBrowserDocument(); recovered.drafts.messages.main = 'snapshot-content';
  tx.objectStore('document').put(value, 'current'); tx.objectStore('recovery').put({schemaVersion: 1, revision: 1, updatedAt: now, document: recovered}, 1);
  await completion(tx); db.close();
  return factory;
}
async function current(factory: IDBFactory) {const db = await rawOpen(factory); const tx = db.transaction('document', 'readonly'); const read = tx.objectStore('document').get('current'); await completion(tx); db.close(); return read.result;}
async function mount(factory: IDBFactory) {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); mounted.push({host, root});
  let retries = 0; const downloads: Array<{data: string; name: string}> = [];
  const port = await openBrowserRecovery(factory, () => now);
  await act(async () => root.render(<StartupRecovery cause={new Error('读取失败')} onRetry={() => {retries++;}} openRecovery={async () => port} download={(data, name) => {downloads.push({data, name});}}/>));
  // Drain the real IndexedDB read requested by the effect before interacting.
  await act(async () => {await port.inspect();});
  const click = async (label: string) => {
    const button = [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === label);
    if (!button) throw new Error(`找不到按钮：${label}`);
    await act(async () => {button.click(); await current(factory);});
  };
  return {host, click, downloads, retried: () => retries};
}
async function file(host: HTMLElement, data: unknown, size?: number) {
  const selected = new File(['fixture'], 'backup.json', {type: 'application/json'});
  Object.defineProperty(selected, 'text', {value: async () => JSON.stringify(data)});
  if (size !== undefined) Object.defineProperty(selected, 'size', {value: size});
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', {configurable: true, value: [selected]});
  await act(async () => input.dispatchEvent(new Event('change', {bubbles: true})));
}

// An automatic restore on selection would fail these original-value checks.
it('previews a validated backup and cancellation preserves corrupt data; only confirmation repairs', async () => {
  const factory = await fixture(); const ui = await mount(factory);
  const incoming = emptyBrowserDocument(); incoming.state.checkins.push({date: '2026-10-05', columnId: 'fixture', note: 'one'});
  const backup = createBackup(incoming, '0.9.0', now);
  await file(ui.host, backup); expect(ui.host.textContent).toContain('1 次打卡');
  expect(await current(factory)).toEqual(corrupt); expect(ui.retried()).toBe(0);
  await ui.click('取消恢复'); expect(await current(factory)).toEqual(corrupt);
  expect(ui.host.textContent).not.toContain('确认修复并恢复');
  await file(ui.host, backup); await ui.click('确认修复并恢复');
  expect((await current(factory)).document.state.checkins).toEqual(incoming.state.checkins); expect(ui.retried()).toBe(1);
});

it('previews a supported recovery snapshot and repairs after confirmation', async () => {
  const factory = await fixture(); const ui = await mount(factory);
  await ui.click('预览此恢复快照'); expect(await current(factory)).toEqual(corrupt);
  expect(ui.host.textContent).toContain('恢复预览'); await ui.click('确认修复并恢复');
  expect((await current(factory)).document.drafts.messages.main).toBe('snapshot-content');
});

it('rejects malformed, future and oversized backups without exposing confirmation or changing originals', async () => {
  const factory = await fixture(); const ui = await mount(factory);
  for (const [data, size] of [[{format: 'unknown'}, undefined], [{format: 'growth-workbench', schemaVersion: 2}, undefined], [{}, 50 * 1024 * 1024 + 1]] as const) {
    await file(ui.host, data, size); expect(ui.host.querySelector('[role="alert"]')).not.toBeNull();
    expect(ui.host.textContent).not.toContain('确认修复并恢复'); expect(await current(factory)).toEqual(corrupt);
  }
});

it('exports exact original only as a clearly labeled local forensic archive', async () => {
  const factory = await fixture(); const ui = await mount(factory);
  expect(ui.host.textContent).toContain('未经清理'); expect(ui.host.textContent).toContain('可能含敏感信息');
  await ui.click('下载原始记录存证（仅本地保管）');
  expect(ui.downloads).toHaveLength(1); expect(JSON.parse(ui.downloads[0].data)).toMatchObject({format: 'growth-workbench-raw-local-archive', raw: corrupt});
  expect(ui.downloads[0].name).toContain('原始存证'); expect(await current(factory)).toEqual(corrupt);
});

it('future data stays read-only with upgrade/local-inspection guidance and a safe snapshot backup export', async () => {
  const original = {schemaVersion: 2, revision: 9, keep: 'future'};
  const factory = await fixture(original); const ui = await mount(factory);
  expect(ui.host.textContent).toContain('较新的工作台'); expect(ui.host.textContent).toContain('IndexedDB');
  expect(ui.host.querySelector('input[type="file"]')).toBeNull();
  expect(ui.host.textContent).not.toContain('确认修复并恢复');
  await ui.click('下载此快照备份'); expect(JSON.parse(ui.downloads[0].data).format).toBe('growth-workbench');
  await ui.click('下载原始记录存证（仅本地保管）'); expect(JSON.parse(ui.downloads[1].data).raw).toEqual(original);
  expect(await current(factory)).toEqual(original);
});

it('a concurrent change rejects confirmed repair and leaves the changed record intact', async () => {
  const factory = await fixture(); const ui = await mount(factory); await ui.click('预览此恢复快照');
  const changed = {...corrupt, document: {retain: 'other-page'}}; const db = await rawOpen(factory);
  const tx = db.transaction('document', 'readwrite'); tx.objectStore('document').put(changed, 'current'); await completion(tx); db.close();
  await ui.click('确认修复并恢复'); expect(ui.host.textContent).toContain('另一个页面');
  expect(await current(factory)).toEqual(changed); expect(ui.retried()).toBe(0);
});
