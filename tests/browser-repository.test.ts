import {afterEach, expect, it, vi} from 'vitest';
import {IDBFactory, IDBObjectStore} from 'fake-indexeddb';
import {openBrowserRepository, type BrowserRepository} from '../src/browser/repository';
import {emptyBrowserDocument} from '../src/core/browser-state';

const now = '2026-10-05T10:00:00.000Z';
const opened: BrowserRepository[] = [];
afterEach(() => {vi.restoreAllMocks(); opened.splice(0).forEach(repo => repo.close());});
async function repo(factory = new IDBFactory()) {const result = await openBrowserRepository(factory, () => now); opened.push(result); return result;}
function document(text: string) {const result = emptyBrowserDocument(); result.drafts.messages.main = text; return result;}
function rawOpen(factory: IDBFactory, version: number) {return new Promise<IDBDatabase>((resolve, reject) => {const request = factory.open('growth-workbench', version); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});}

it('rejectsStaleRevisionWithoutOverwritingNewestCode', async () => {
  const factory = new IDBFactory(); const a = await repo(factory); const b = await repo(factory);
  expect((await a.load()).revision).toBe(0); expect((await b.load()).revision).toBe(0);
  expect((await a.commit(document('return name'), 0)).revision).toBe(1);
  await expect(b.commit(document('stale code'), 0)).rejects.toMatchObject({code: 'revision-conflict'});
  expect((await b.load()).document.drafts.messages.main).toBe('return name');
});
it('rollsBackReplaceWhenRecoveryWriteFails', async () => {
  const r = await repo(); await r.commit(document('original'), 0);
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, ...args: Parameters<typeof put>) {
    if (this.name === 'recovery') throw new DOMException('full', 'QuotaExceededError');
    return put.apply(this, args);
  });
  await expect(r.replace(document('replacement'), 1)).rejects.toMatchObject({code: 'quota'});
  expect(await r.load()).toMatchObject({revision: 1, document: {drafts: {messages: {main: 'original'}}}});
  expect(await r.recoveries()).toEqual([]);
});
it('preserves the three newest complete recovery snapshots', async () => {
  const r = await repo();
  for (let i = 0; i < 5; i++) await r.replace(document(`version ${i}`), i);
  const snapshots = await r.recoveries();
  expect(snapshots.map(item => item.revision)).toEqual([4, 3, 2]);
  expect(snapshots.map(item => item.document.drafts.messages.main)).toEqual(['version 3', 'version 2', 'version 1']);
});
it('refusesFutureDbVersionWithoutResetting', async () => {
  const factory = new IDBFactory(); const db = await rawOpen(factory, 2); db.close();
  await expect(openBrowserRepository(factory)).rejects.toMatchObject({code: 'future-schema'});
  const request = factory.open('growth-workbench');
  const reopened = await new Promise<IDBDatabase>(resolve => {request.onsuccess = () => resolve(request.result);});
  expect(reopened.version).toBe(2); reopened.close();
});
it('rejects invalid or future stored snapshots without replacing them', async () => {
  const factory = new IDBFactory(); const r = await repo(factory); const db = await rawOpen(factory, 1);
  const tx = db.transaction('document', 'readwrite'); tx.objectStore('document').put({schemaVersion: 2, revision: 77, untouched: 'retained'}, 'current');
  await new Promise<void>(resolve => {tx.oncomplete = () => resolve();}); db.close();
  await expect(r.load()).rejects.toMatchObject({code: 'future-schema'});
  await expect(r.commit(document('overwrite'), 0)).rejects.toMatchObject({code: 'future-schema'});
});
it('rejects malformed current documents before opening a write transaction', async () => {
  const r = await repo(); const malformed: any = document('bad'); delete malformed.state.lab;
  await expect(r.commit(malformed, 0)).rejects.toMatchObject({code: 'invalid'});
  expect((await r.load()).revision).toBe(0);
});
it('resolves commit only after transaction completion and rolls back aborts after put success', async () => {
  const r = await repo(); const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, ...args: Parameters<typeof put>) {
    const request = put.apply(this, args);
    if (this.name === 'document') request.addEventListener('success', () => this.transaction.abort());
    return request;
  });
  await expect(r.commit(document('not committed'), 0)).rejects.toMatchObject({code: 'unavailable'});
  expect((await r.load()).revision).toBe(0);
});
it('closes on versionchange and refuses later writes', async () => {
  const factory = new IDBFactory(); const r = await repo(factory); const upgraded = await rawOpen(factory, 2); upgraded.close();
  await expect(r.load()).rejects.toMatchObject({code: 'unavailable'});
  await expect(r.commit(document('late'), 0)).rejects.toMatchObject({code: 'unavailable'});
});
