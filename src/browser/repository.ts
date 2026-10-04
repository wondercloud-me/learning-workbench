import {emptyBrowserDocument, requireRecord, validateBrowserDocument, type BrowserDocument, type BrowserSnapshot} from '../core/browser-state';

export type BrowserStorageErrorCode = 'revision-conflict' | 'quota' | 'unavailable' | 'invalid' | 'future-schema';
export class BrowserStorageError extends Error {
  constructor(public readonly code: BrowserStorageErrorCode, message: string) {super(message); this.name = 'BrowserStorageError';}
}
export interface BrowserRepository {
  load(): Promise<BrowserSnapshot>;
  commit(document: BrowserDocument, expectedRevision: number): Promise<BrowserSnapshot>;
  replace(document: BrowserDocument, expectedRevision: number): Promise<BrowserSnapshot>;
  recoveries(): Promise<BrowserSnapshot[]>;
  subscribe(listener: (revision: number) => void): () => void;
  flush(): Promise<void>;
  close(): void;
}

/** A token belongs to one recovery connection and one inspected raw value. */
export type BrowserRecoveryToken = {readonly recoveryToken: unique symbol};
export interface BrowserRecoveryInspection {
  kind: 'invalid' | 'valid' | 'future' | 'unrecognized';
  databaseVersion: number;
  canRepair: boolean;
  canArchive: boolean;
  recoveries: BrowserSnapshot[];
  token: BrowserRecoveryToken;
}
/** Startup-only port: never initializes a database or bypasses normal load. */
export interface BrowserRecovery {
  inspect(): Promise<BrowserRecoveryInspection>;
  repair(document: BrowserDocument, token: BrowserRecoveryToken): Promise<BrowserSnapshot>;
  rawArchive(token: BrowserRecoveryToken): Promise<string>;
  close(): void;
}

const localConnections = new WeakMap<IDBFactory, Set<(revision: number, source: object) => void>>();
const unavailable = () => new BrowserStorageError('unavailable', '浏览器存储不可用，请重新打开并导出已有内容。');
function storageError(cause: unknown): BrowserStorageError {
  if (cause instanceof BrowserStorageError) return cause;
  const name = cause && typeof cause === 'object' && 'name' in cause ? cause.name : '';
  if (name === 'QuotaExceededError') return new BrowserStorageError('quota', '存储空间不足，内容尚未保存，请先导出待存备份。');
  if (name === 'VersionError') return new BrowserStorageError('future-schema', '数据库属于未来版本，请使用较新的工作台打开。');
  return unavailable();
}
function validateDocument(document: unknown): BrowserDocument {
  try {return validateBrowserDocument(document);} catch (cause) {throw new BrowserStorageError('invalid', cause instanceof Error ? cause.message : '学习文档格式不正确。');}
}
function validateSnapshot(value: unknown): BrowserSnapshot {
  try {
    const item = requireRecord(value, 'snapshot');
    if (typeof item.schemaVersion === 'number' && item.schemaVersion > 1) throw new BrowserStorageError('future-schema', '学习数据属于未来版本，请使用较新的工作台打开。');
    if (item.schemaVersion !== 1 || !Number.isSafeInteger(item.revision) || (item.revision as number) < 0 || typeof item.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(item.updatedAt) || !Number.isFinite(Date.parse(item.updatedAt))) throw new Error('学习快照格式不正确。');
    return {schemaVersion: 1, revision: item.revision as number, updatedAt: item.updatedAt, document: validateDocument(item.document)};
  } catch (cause) {if (cause instanceof BrowserStorageError) throw cause; throw new BrowserStorageError('invalid', '学习快照格式不正确，已保留原数据。');}
}

// Only exact JSON-shaped raw values can be compared and archived without a
// lossy codec. Unknown structured-clone types, sparse arrays, undefined object
// fields and exceptional numeric values require manual inspection instead.
function rawFingerprint(value: unknown, depth = 0): string {
  if (depth > 100) throw new Error('原记录结构过深，不能安全比较。');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw new Error('原记录包含非标准数组。');
    return `[${Array.from(value, item => rawFingerprint(item, depth + 1)).join(',')}]`;
  }
  const record = requireRecord(value, '原记录');
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${rawFingerprint(record[key], depth + 1)}`).join(',')}}`;
}

/** Open existing data at its actual version. Aborting onupgradeneeded is
 * essential: this diagnostic path must not create even an empty database. */
export async function openBrowserRecovery(factory: IDBFactory | undefined = globalThis.indexedDB, clock: () => string = () => new Date().toISOString()): Promise<BrowserRecovery> {
  if (!factory) throw unavailable();
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    let cancelled = false;
    try {request = factory.open('growth-workbench');} catch (cause) {reject(storageError(cause)); return;}
    request.onupgradeneeded = () => request.transaction?.abort();
    request.onerror = () => reject(storageError(request.error));
    request.onblocked = () => {cancelled = true; reject(unavailable());};
    request.onsuccess = () => {if (cancelled) request.result.close(); else resolve(request.result);};
  });
  let closed = false;
  const close = () => {closed = true; db.close();};
  db.onversionchange = close;
  const names = ['document', 'recovery', 'metadata'];
  let recognized = db.version === 1 && db.objectStoreNames.length === names.length && names.every(name => db.objectStoreNames.contains(name));
  if (recognized) {
    const tx = db.transaction(names, 'readonly');
    recognized = names.every(name => {const store = tx.objectStore(name); return store.keyPath === null && !store.autoIncrement && store.indexNames.length === 0;});
  }
  type Inspected = {kind: BrowserRecoveryInspection['kind']; raw?: unknown; exists: boolean; fingerprint?: string};
  const inspections = new WeakMap<BrowserRecoveryToken, Inspected>();
  const tokenFor = (value: Inspected): BrowserRecoveryToken => {const token = {} as BrowserRecoveryToken; inspections.set(token, value); return token;};
  const ensureOpen = () => {if (closed) throw unavailable();};
  const transact = <T>(mode: IDBTransactionMode, start: (tx: IDBTransaction, result: (value: T) => void, fail: (cause: unknown) => void) => void): Promise<T> => {
    try {ensureOpen();} catch (cause) {return Promise.reject(cause);}
    return new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      try {tx = db.transaction(names, mode);} catch (cause) {reject(storageError(cause)); return;}
      let value: T;
      let failure: BrowserStorageError | undefined;
      const fail = (cause: unknown) => {failure = storageError(cause); try {tx.abort();} catch {reject(failure);}};
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(failure ?? storageError(tx.error));
      try {start(tx, result => {value = result;}, fail);} catch (cause) {fail(cause);}
    });
  };
  const classify = (raw: unknown): 'invalid' | 'valid' | 'future' => {
    try {validateSnapshot(raw); return 'valid';} catch (cause) {return cause instanceof BrowserStorageError && cause.code === 'future-schema' ? 'future' : 'invalid';}
  };
  const supportedRecoveries = (values: unknown[]): BrowserSnapshot[] => values.flatMap(value => {try {return [validateSnapshot(value)];} catch {return [];}}).sort((a,b) => b.revision - a.revision).slice(0, 3);
  const requireToken = (token: BrowserRecoveryToken): Inspected => {
    ensureOpen();
    const inspected = inspections.get(token);
    if (!inspected) throw new BrowserStorageError('invalid', '请先重新检查原记录，再预览恢复内容。');
    if (db.version > 1) throw new BrowserStorageError('future-schema', '未来版本数据库只读，请使用较新的工作台打开并导出备份。');
    if (!recognized) throw new BrowserStorageError('invalid', '数据库结构无法识别，请保留网站数据并在本地检查。');
    return inspected;
  };
  return {
    close,
    inspect: async () => {
      ensureOpen();
      if (!recognized) {
        const kind = db.version > 1 ? 'future' : 'unrecognized';
        return {kind, databaseVersion: db.version, canRepair: false, canArchive: false, recoveries: [], token: tokenFor({kind, exists: false})};
      }
      return transact<BrowserRecoveryInspection>('readonly', (tx, result, fail) => {
        const current = tx.objectStore('document').get('current');
        const key = tx.objectStore('document').getKey('current');
        const recovery = tx.objectStore('recovery').getAll();
        recovery.onsuccess = () => {
          try {
            const raw: unknown = current.result;
            const exists = key.result !== undefined;
            const kind = classify(raw);
            let fingerprint: string | undefined;
            try {fingerprint = exists ? rawFingerprint(raw) : 'missing';} catch {/* Refuse writes and lossy archive exports. */}
            result({kind, databaseVersion: db.version, canRepair: kind === 'invalid' && fingerprint !== undefined, canArchive: fingerprint !== undefined, recoveries: supportedRecoveries(recovery.result), token: tokenFor({kind, raw, exists, fingerprint})});
          } catch (cause) {fail(cause);}
        };
      });
    },
    rawArchive: async token => {
      const inspected = requireToken(token);
      if (inspected.fingerprint === undefined) throw new BrowserStorageError('invalid', '原记录包含无法无损导出的结构，请在浏览器开发者工具中本地检查。');
      // Deliberately unsanitized forensic archive; never a portable backup.
      return JSON.stringify({format: 'growth-workbench-raw-local-archive', databaseVersion: 1, store: 'document', key: 'current', recordExists: inspected.exists, raw: inspected.raw}, null, 2);
    },
    repair: async (input, token) => {
      const inspected = requireToken(token);
      if (inspected.kind === 'future') throw new BrowserStorageError('future-schema', '未来版本数据只读，请使用较新的工作台打开并导出备份。');
      if (inspected.kind !== 'invalid' || inspected.fingerprint === undefined) throw new BrowserStorageError('invalid', '仅能修复可安全比较的损坏记录；有效记录不会被替换。');
      const document = validateDocument(input);
      const updatedAt = validateSnapshot({schemaVersion: 1, revision: 0, updatedAt: clock(), document}).updatedAt;
      return transact<BrowserSnapshot>('readwrite', (tx, result, fail) => {
        const current = tx.objectStore('document').get('current');
        const key = tx.objectStore('document').getKey('current');
        const recovery = tx.objectStore('recovery').getAll();
        recovery.onsuccess = () => {
          try {
            const raw: unknown = current.result;
            const exists = key.result !== undefined;
            if (classify(raw) === 'future') throw new BrowserStorageError('future-schema', '记录已更新到未来版本，请使用较新的工作台打开。');
            let fingerprint: string;
            try {fingerprint = exists ? rawFingerprint(raw) : 'missing';} catch {throw new BrowserStorageError('invalid', '原记录已变为无法安全比较的结构，未执行恢复。');}
            if (exists !== inspected.exists || fingerprint !== inspected.fingerprint) throw new BrowserStorageError('revision-conflict', '另一个页面已改变原记录。请重新读取并检查，未执行恢复。');
            if (classify(raw) !== 'invalid') throw new BrowserStorageError('invalid', '当前记录有效，未执行恢复。');
            const rawRevision = raw !== null && typeof raw === 'object' && 'revision' in raw ? raw.revision : undefined;
            const revisions = supportedRecoveries(recovery.result).map(item => item.revision);
            if (Number.isSafeInteger(rawRevision) && (rawRevision as number) >= 0) revisions.push(rawRevision as number);
            const previous = Math.max(0, ...revisions);
            if (previous === Number.MAX_SAFE_INTEGER) throw new BrowserStorageError('invalid', '修订号已达到安全上限，请保留原库并使用较新的工作台处理。');
            const next: BrowserSnapshot = {schemaVersion: 1, revision: previous + 1, updatedAt, document};
            const archiveKey = `startup-original:${globalThis.crypto.randomUUID()}`;
            tx.objectStore('metadata').add({kind: 'startup-original', recordExists: exists, raw, capturedAt: updatedAt}, archiveKey);
            tx.objectStore('document').put(next, 'current');
            result(next);
          } catch (cause) {fail(cause);}
        };
      });
    }
  };
}

export async function openBrowserRepository(factory: IDBFactory | undefined = globalThis.indexedDB, clock: () => string = () => new Date().toISOString()): Promise<BrowserRepository> {
  if (!factory) throw unavailable();
  const initial = validateSnapshot({schemaVersion: 1, revision: 0, updatedAt: clock(), document: emptyBrowserDocument()});
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    let cancelled = false;
    try {request = factory.open('growth-workbench', 1);} catch (cause) {reject(storageError(cause)); return;}
    request.onupgradeneeded = event => {
      // Only a genuinely new database receives an initial document. Missing or
      // corrupt state in an existing database must never become an empty save.
      if (event.oldVersion !== 0) {request.transaction?.abort(); return;}
      request.result.createObjectStore('document').put(initial, 'current');
      request.result.createObjectStore('recovery');
      request.result.createObjectStore('metadata');
    };
    request.onerror = () => reject(storageError(request.error));
    request.onblocked = () => {cancelled = true; reject(unavailable());};
    request.onsuccess = () => {if (cancelled) request.result.close(); else resolve(request.result);};
  });
  const identity = {};
  let closed = false;
  const listeners = new Set<(revision: number) => void>();
  const writes = new Set<Promise<unknown>>();
  const connections = localConnections.get(factory) ?? new Set<(revision: number, source: object) => void>();
  localConnections.set(factory, connections);
  const notify = (revision: number) => {for (const listener of listeners) {try {listener(revision);} catch {/* A UI listener cannot change transaction outcome. */}}};
  const localListener = (revision: number, source: object) => {if (source !== identity) notify(revision);};
  connections.add(localListener);
  // Custom factories isolate test databases. Real browser tabs share the same
  // channel; hints never replace the transaction's revision comparison.
  let channel: BroadcastChannel | undefined;
  if (factory === globalThis.indexedDB && typeof globalThis.BroadcastChannel === 'function') {
    try {channel = new BroadcastChannel('growth-workbench-revisions'); channel.onmessage = event => {if (Number.isSafeInteger(event.data) && event.data >= 0) notify(event.data);};} catch {/* CAS works without cross-tab messaging. */}
  }
  const close = () => {if (closed) return; closed = true; notify(-1); connections.delete(localListener); channel?.close(); listeners.clear(); db.close();};
  db.onversionchange = close;
  const transact = <T>(stores: string[], mode: IDBTransactionMode, start: (tx: IDBTransaction, result: (value: T) => void, fail: (cause: unknown) => void) => void): Promise<T> => {
    if (closed) return Promise.reject(unavailable());
    return new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      try {tx = db.transaction(stores, mode);} catch (cause) {reject(storageError(cause)); return;}
      let result: T;
      let failure: BrowserStorageError | undefined;
      const fail = (cause: unknown) => {failure = storageError(cause); try {tx.abort();} catch {reject(failure);}};
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure ?? storageError(tx.error));
      try {start(tx, value => {result = value;}, fail);} catch (cause) {fail(cause);}
    });
  };
  const readCurrent = (tx: IDBTransaction, use: (snapshot: BrowserSnapshot) => void, fail: (cause: unknown) => void) => {
    const request = tx.objectStore('document').get('current');
    request.onsuccess = () => {try {use(validateSnapshot(request.result));} catch (cause) {fail(cause);}};
  };
  const write = (input: BrowserDocument, expectedRevision: number, replacing: boolean): Promise<BrowserSnapshot> => {
    let document: BrowserDocument;
    let updatedAt: string;
    try {
      document = validateDocument(input);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision === Number.MAX_SAFE_INTEGER) throw new BrowserStorageError('invalid', '修订号不正确。');
      updatedAt = validateSnapshot({schemaVersion: 1, revision: expectedRevision + 1, updatedAt: clock(), document}).updatedAt;
    } catch (cause) {return Promise.reject(storageError(cause));}
    const pending = transact<BrowserSnapshot>(replacing ? ['document', 'recovery'] : ['document'], 'readwrite', (tx, result, fail) => {
      readCurrent(tx, previous => {
        if (previous.revision !== expectedRevision) {fail(new BrowserStorageError('revision-conflict', '另一个页面已保存新记录，请先导出待存内容再读取最新记录。')); return;}
        const next: BrowserSnapshot = {schemaVersion: 1, revision: expectedRevision + 1, updatedAt, document};
        if (replacing) {
          const recovery = tx.objectStore('recovery');
          recovery.put(previous, previous.revision);
          const keys = recovery.getAllKeys();
          keys.onsuccess = () => {for (const key of keys.result.slice(0, Math.max(0, keys.result.length - 3))) recovery.delete(key);};
        }
        tx.objectStore('document').put(next, 'current');
        result(next);
      }, fail);
    }).then(snapshot => {
      for (const connection of connections) connection(snapshot.revision, identity);
      try {channel?.postMessage(snapshot.revision);} catch {/* Messaging is a hint. */}
      return snapshot;
    });
    writes.add(pending); void pending.then(() => writes.delete(pending), () => writes.delete(pending));
    return pending;
  };
  return {
    load: () => transact<BrowserSnapshot>(['document'], 'readonly', (tx, result, fail) => readCurrent(tx, result, fail)),
    commit: (document, revision) => write(document, revision, false),
    replace: (document, revision) => write(document, revision, true),
    recoveries: () => transact<BrowserSnapshot[]>(['recovery'], 'readonly', (tx, result, fail) => {
      const request = tx.objectStore('recovery').getAll();
      request.onsuccess = () => {try {result(request.result.map(validateSnapshot).sort((a,b) => b.revision - a.revision).slice(0,3));} catch (cause) {fail(cause);}};
    }),
    subscribe: listener => {if (closed) {listener(-1); return () => {};} listeners.add(listener); return () => {listeners.delete(listener);};},
    flush: async () => {if (closed) throw unavailable(); while (writes.size) await Promise.all([...writes]); if (closed) throw unavailable();}, close
  };
}
