import {afterEach, expect, it, vi} from 'vitest';
import {IDBFactory, IDBObjectStore} from 'fake-indexeddb';
import {openBrowserRecovery, openBrowserRepository, type BrowserRecovery} from '../src/browser/repository';
import {emptyBrowserDocument} from '../src/core/browser-state';

const now = '2026-10-05T10:00:00.000Z';
const opened: BrowserRecovery[] = [];
afterEach(() => {vi.restoreAllMocks(); opened.splice(0).forEach(value => value.close());});
const corrupt = {schemaVersion: 1, revision: 7, updatedAt: now, document: {lost: '保留原始文字'}, extra: {secret: 'raw-secret'}};
function document(text: string) {const value = emptyBrowserDocument(); value.drafts.messages.main = text; return value;}
async function seed(factory: IDBFactory, value: unknown, recoveries: unknown[] = []) {
  const repository = await openBrowserRepository(factory, () => now); repository.close();
  const db = await rawOpen(factory);
  const tx = db.transaction(['document', 'recovery'], 'readwrite');
  tx.objectStore('document').put(value, 'current');
  recoveries.forEach((item, index) => tx.objectStore('recovery').put(item, index));
  await completed(tx); db.close();
}
function rawOpen(factory: IDBFactory, version?: number) {return new Promise<IDBDatabase>((resolve, reject) => {const request = version === undefined ? factory.open('growth-workbench') : factory.open('growth-workbench', version); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});}
function completed(tx: IDBTransaction) {return new Promise<void>((resolve, reject) => {tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);});}
async function read(factory: IDBFactory, store = 'document') {
  const db = await rawOpen(factory); const tx = db.transaction(store, 'readonly'); const request = tx.objectStore(store).getAll();
  await completed(tx); db.close(); return request.result;
}
async function recovery(factory: IDBFactory) {const value = await openBrowserRecovery(factory, () => now); opened.push(value); return value;}

// Removing the atomic archive or changing this path to an empty initialization
// would lose the exact invalid value even though normal loading succeeds later.
it('inspects corrupt current without changes and repairs with exact original in the same transaction', async () => {
  const factory = new IDBFactory(); await seed(factory, corrupt);
  const port = await recovery(factory); const inspection = await port.inspect();
  expect(inspection.kind).toBe('invalid'); expect(inspection.canRepair).toBe(true);
  expect(await read(factory)).toEqual([corrupt]);
  const archive = JSON.parse(await port.rawArchive(inspection.token));
  expect(archive.format).toBe('growth-workbench-raw-local-archive'); expect(archive.raw).toEqual(corrupt);
  const result = await port.repair(document('restored'), inspection.token);
  expect(result.revision).toBe(8); expect(result.document.drafts.messages.main).toBe('restored');
  const originals = await read(factory, 'metadata');
  expect(originals).toHaveLength(1); expect(originals[0]).toMatchObject({kind: 'startup-original', raw: corrupt, recordExists: true});
  port.close(); const normal = await openBrowserRepository(factory, () => now);
  expect((await normal.load()).document.drafts.messages.main).toBe('restored'); normal.close();
});

it('offers only valid supported recoveries and validates repair input before writing', async () => {
  const factory = new IDBFactory(); const valid = {schemaVersion: 1, revision: 10, updatedAt: now, document: document('snapshot')};
  await seed(factory, corrupt, [valid, {schemaVersion: 2, revision: 12}, {schemaVersion: 1, document: {}}]);
  const port = await recovery(factory); const inspection = await port.inspect();
  expect(inspection.recoveries).toEqual([valid]);
  await expect(port.repair({} as any, inspection.token)).rejects.toMatchObject({code: 'invalid'});
  expect(await read(factory)).toEqual([corrupt]); expect(await read(factory, 'metadata')).toEqual([]);
  expect((await port.repair(inspection.recoveries[0].document, inspection.token)).revision).toBe(11);
  expect((await read(factory, 'recovery')).length).toBe(3);
});

it.each([
  ['valid', {schemaVersion: 1, revision: 0, updatedAt: now, document: document('valid')}],
  ['future', {schemaVersion: 2, revision: 1, raw: 'future'}]
])('protects %s current snapshots from all repair writes', async (kind, original) => {
  const factory = new IDBFactory(); await seed(factory, original);
  const port = await recovery(factory); const inspection = await port.inspect();
  expect(inspection.kind).toBe(kind); expect(inspection.canRepair).toBe(false);
  expect(JSON.parse(await port.rawArchive(inspection.token)).raw).toEqual(original);
  await expect(port.repair(document('overwrite'), inspection.token)).rejects.toMatchObject({code: kind === 'future' ? 'future-schema' : 'invalid'});
  expect(await read(factory)).toEqual([original]); expect(await read(factory, 'metadata')).toEqual([]);
});

it('opens a future database read-only without assuming its stores or downgrading it', async () => {
  const factory = new IDBFactory(); const db = await rawOpen(factory, 2); db.close();
  const port = await recovery(factory); const inspection = await port.inspect();
  expect(inspection.kind).toBe('future'); expect(inspection.databaseVersion).toBe(2); expect(inspection.canRepair).toBe(false);
  await expect(port.repair(document('overwrite'), inspection.token)).rejects.toMatchObject({code: 'future-schema'});
  await expect(port.rawArchive(inspection.token)).rejects.toMatchObject({code: 'future-schema'});
  const unchanged = await rawOpen(factory); expect(unchanged.version).toBe(2); expect(unchanged.objectStoreNames.length).toBe(0); unchanged.close();
});

it('does not create any database when recovery is opened before one exists', async () => {
  const factory = new IDBFactory();
  await expect(openBrowserRecovery(factory)).rejects.toMatchObject({code: 'unavailable'});
  expect(await factory.databases()).toEqual([]);
});

it('rejects a concurrent raw change even if the corrupt revision did not change', async () => {
  const factory = new IDBFactory(); await seed(factory, corrupt);
  const port = await recovery(factory); const inspection = await port.inspect();
  const changed = {...corrupt, extra: {secret: 'different'}}; const db = await rawOpen(factory);
  const tx = db.transaction('document', 'readwrite'); tx.objectStore('document').put(changed, 'current'); await completed(tx); db.close();
  await expect(port.repair(document('overwrite'), inspection.token)).rejects.toMatchObject({code: 'revision-conflict'});
  expect(await read(factory)).toEqual([changed]); expect(await read(factory, 'metadata')).toEqual([]);
});

it.each(['metadata', 'document'])('aborts repair if %s write fails, preserving original and leaving no archive residue', async store => {
  const factory = new IDBFactory(); await seed(factory, corrupt);
  const port = await recovery(factory); const inspection = await port.inspect();
  const method = store === 'metadata' ? 'add' : 'put'; const original = IDBObjectStore.prototype[method];
  vi.spyOn(IDBObjectStore.prototype, method).mockImplementation(function(this: IDBObjectStore, ...args: Parameters<typeof original>) {
    if (this.name === store) throw new DOMException('full', 'QuotaExceededError');
    return original.apply(this, args);
  });
  await expect(port.repair(document('overwrite'), inspection.token)).rejects.toMatchObject({code: 'quota'});
  expect(await read(factory)).toEqual([corrupt]); expect(await read(factory, 'metadata')).toEqual([]);
});

it('does not report repair success when the transaction aborts after the document put succeeds', async () => {
  const factory = new IDBFactory(); await seed(factory, corrupt);
  const port = await recovery(factory); const inspection = await port.inspect();
  const original = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, ...args: Parameters<typeof original>) {
    const request = original.apply(this, args);
    if (this.name === 'document') request.addEventListener('success', () => this.transaction.abort());
    return request;
  });
  await expect(port.repair(document('not committed'), inspection.token)).rejects.toMatchObject({code: 'unavailable'});
  expect(await read(factory)).toEqual([corrupt]); expect(await read(factory, 'metadata')).toEqual([]);
});

it('rejects a stale corruption token after another page installs a future snapshot', async () => {
  const factory = new IDBFactory(); await seed(factory, corrupt);
  const port = await recovery(factory); const inspection = await port.inspect();
  const future = {schemaVersion: 2, revision: 0}; const db = await rawOpen(factory);
  const tx = db.transaction('document', 'readwrite'); tx.objectStore('document').put(future, 'current'); await completed(tx); db.close();
  await expect(port.repair(document('overwrite'), inspection.token)).rejects.toMatchObject({code: 'future-schema'});
  expect(await read(factory)).toEqual([future]); expect(await read(factory, 'metadata')).toEqual([]);
});

it('refuses unsafe structured data and exhausted safe revisions rather than silently normalizing or overflowing', async () => {
  const factory = new IDBFactory(); await seed(factory, {...corrupt, raw: new Map([['keep', 'value']])});
  const port = await recovery(factory); let inspection = await port.inspect();
  expect(inspection.canRepair).toBe(false); await expect(port.repair(document('overwrite'), inspection.token)).rejects.toMatchObject({code: 'invalid'});
  port.close(); await seed(factory, {...corrupt, revision: Number.MAX_SAFE_INTEGER});
  const other = await recovery(factory); inspection = await other.inspect();
  await expect(other.repair(document('overwrite'), inspection.token)).rejects.toMatchObject({code: 'invalid'});
  expect((await read(factory))[0].revision).toBe(Number.MAX_SAFE_INTEGER);
});

it('refuses an unrecognized store shape', async () => {
  const factory = new IDBFactory(); const db = await rawOpen(factory, 1); db.close();
  const port = await recovery(factory); const inspection = await port.inspect();
  expect(inspection.kind).toBe('unrecognized'); expect(inspection.canRepair).toBe(false);
  await expect(port.repair(document('overwrite'), inspection.token)).rejects.toMatchObject({code: 'invalid'});
});

it('closes recovery on database upgrade and refuses later repairs', async () => {
  const factory = new IDBFactory(); await seed(factory, corrupt);
  const port = await recovery(factory); const inspection = await port.inspect();
  const upgraded = await rawOpen(factory, 2); upgraded.close();
  await expect(port.repair(document('overwrite'), inspection.token)).rejects.toMatchObject({code: 'unavailable'});
});
