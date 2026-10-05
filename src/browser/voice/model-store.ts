import {VOICE_RESOURCES, voiceManifestJson, type VoiceManifest, type VoiceResource, type VoiceResourceRole} from './manifest';

export interface VoiceCache {put(key: string, response: Response): Promise<void>; match(key: string): Promise<Response | undefined>;}
export interface VoiceCaches {open(name: string): Promise<VoiceCache>; keys(): Promise<string[]>; delete(name: string): Promise<boolean>;}
export interface VoiceStorePorts {
  caches: VoiceCaches;
  fetch(input: string, init: RequestInit): Promise<Response>;
  crypto: Pick<Crypto, 'subtle'>;
  origin: string;
  generationId(): string;
}
export interface VoiceDownloadProgress {receivedBytes: number; totalBytes: number; currentFile: string; fileReceivedBytes: number; fileTotalBytes: number;}
export interface VoiceModelStore {
  status(): 'missing' | 'downloading' | 'ready';
  download(progress?: (value: VoiceDownloadProgress) => void): Promise<void>;
  cancel(): Promise<void>;
  delete(): Promise<void>;
  load(): Promise<Record<VoiceResourceRole, ArrayBuffer>>;
}
export type VoiceStoreErrorCode = 'busy' | 'cancelled' | 'missing' | 'integrity' | 'opaque' | 'http' | 'network' | 'quota' | 'storage' | 'unsupported';
export class VoiceStoreError extends Error {
  constructor(public readonly code: VoiceStoreErrorCode, message: string) {super(message); this.name = 'VoiceStoreError';}
}
const error = (code: VoiceStoreErrorCode, message: string) => new VoiceStoreError(code, message);
const cancelled = () => error('cancelled','下载或缓存读取已取消。');
const storageError = (cause: unknown): VoiceStoreError => cause instanceof VoiceStoreError ? cause
  : cause instanceof DOMException && cause.name === 'QuotaExceededError' ? error('quota','空间不足，请删除可选下载后重试。')
  : error('storage','可选语音缓存不可用，请继续键盘输入或删除后重新下载。');
const contentTypes: Record<VoiceResourceRole, string> = {
  glue:'application/javascript', wasm:'application/wasm', wrapper:'application/javascript',
  model:'application/octet-stream', tokens:'text/plain; charset=utf-8',
  worker:'application/javascript', worklet:'application/javascript',
};

/** No learner state or shell cache is read here. Manifest JSON is validated by manifest.ts. */
export function createVoiceModelStore(input: VoiceManifest, ports: VoiceStorePorts): VoiceModelStore {
  // Own a snapshot: callers cannot change byte/hash expectations during an await.
  const manifest: VoiceManifest = JSON.parse(voiceManifestJson(input));
  const namespace = VOICE_RESOURCES.namespace + ':';
  const origin = new URL(ports.origin).origin;
  const urls = manifest.files.map(file => new URL(file.url, origin).href);
  const markerUrl = new URL(manifest.basePath + 'ready.json', origin).href;
  const totalBytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
  let generation = 0; let deletionGeneration = 0; let ready = false;
  let deleting: Promise<void> = Promise.resolve();
  type Attempt = {generation: number; abort: AbortController; name?: string; cache?: Promise<VoiceCache>; committed: boolean};
  let active: Attempt | undefined;
  const current = (observed: number) => {if (observed !== generation) throw cancelled();};
  const digest = async (buffer: ArrayBuffer) => {
    if (!ports.crypto?.subtle) throw error('unsupported','浏览器缺少 WebCrypto，不能验证本地模型。');
    const result = await ports.crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2,'0')).join('');
  };
  // Construct lazily so opening the application does not touch optional storage.
  const identity = () => digest(new TextEncoder().encode(voiceManifestJson(manifest)).buffer);
  const detach = async (attempt: Attempt | undefined) => {
    if (!attempt?.name) return;
    // A late open must finish before its name is removed. Late puts retain only
    // this detached handle; the next attempt never reuses a cache name.
    try {await attempt.cache;} catch {/* A failed open has no live handle. */}
    await ports.caches.delete(attempt.name);
  };
  const verify = async (response: Response | undefined, file: VoiceResource, observed: number): Promise<ArrayBuffer> => {
    current(observed);
    if (!response) throw error('missing','可选资源缺失；离线时请继续键盘输入，联网后重新下载。');
    if (response.type === 'opaque' || response.type === 'opaqueredirect') throw error('opaque','模型响应不可读，无法进行本地校验。');
    const buffer = await response.arrayBuffer(); current(observed);
    if (buffer.byteLength !== file.bytes || await digest(buffer) !== file.sha256) throw error('integrity','模型资源大小或 SHA-256 不匹配，请删除后重新下载。');
    current(observed); return buffer;
  };
  const cancel = () => {
    generation++; const previous = active; active = undefined; previous?.abort.abort();
    return detach(previous).catch(cause => {throw storageError(cause);});
  };
  return {
    status: () => active ? 'downloading' : ready ? 'ready' : 'missing',
    cancel,
    delete: () => {
      deletionGeneration++; ready = false;
      const stopping = cancel();
      deleting = deleting.catch(() => {}).then(async () => {
        await stopping;
        const names = await ports.caches.keys();
        await Promise.all(names.filter(name => name.startsWith(namespace)).map(name => ports.caches.delete(name)));
      }).catch(cause => {throw storageError(cause);});
      return deleting;
    },
    download: async progress => {
      if (active) throw error('busy','已经有一个模型下载正在进行。');
      if (!ports.caches || !ports.fetch || !ports.crypto?.subtle) throw error('unsupported','浏览器缺少模型缓存或校验能力。');
      const attempt: Attempt = {generation:++generation,abort:new AbortController(),committed:false}; active = attempt;
      const check = () => {current(attempt.generation); if (active !== attempt || attempt.abort.signal.aborted) throw cancelled();};
      let receivedBytes = 0;
      try {
        await deleting; check();
        const manifestDigest = await identity(); check();
        const id = ports.generationId();
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw error('storage','缓存代次编号无效。');
        attempt.name = `${namespace}${manifestDigest}:${id}-${attempt.generation}`;
        attempt.cache = ports.caches.open(attempt.name); const cache = await attempt.cache; check();
        for (let index = 0; index < manifest.files.length; index++) {
          const file = manifest.files[index]; check();
          let response: Response;
          try {response = await ports.fetch(new URL(file.downloadUrl,origin).href,{signal:attempt.abort.signal,credentials:'omit',cache:'no-store',mode:'cors'});}
          catch (cause) {check(); throw error('network','资源下载失败；请检查网络和 CORS 后重试。');}
          check();
          if (response.type === 'opaque' || response.type === 'opaqueredirect') throw error('opaque','下载响应不可读，无法校验。');
          if (!response.ok) throw error('http',`资源下载失败（HTTP ${response.status}）。`);
          if (!response.body) throw error('integrity','下载响应没有可读取的字节。');
          const reader = response.body.getReader(); let fileReceivedBytes = 0;
          const abortReader = () => {void reader.cancel().catch(() => {});};
          attempt.abort.signal.addEventListener('abort',abortReader,{once:true});
          const body = new ReadableStream<Uint8Array>({
            async pull(controller) {
              try {
                check(); const chunk = await reader.read(); check();
                if (chunk.done) {
                  if (fileReceivedBytes !== file.bytes) throw error('integrity','下载字节数不足，未保存就绪模型。');
                  controller.close(); return;
                }
                fileReceivedBytes += chunk.value.byteLength; receivedBytes += chunk.value.byteLength;
                if (fileReceivedBytes > file.bytes) throw error('integrity','下载字节数超过清单大小，已停止下载。');
                progress?.({receivedBytes,totalBytes,currentFile:file.filename,fileReceivedBytes,fileTotalBytes:file.bytes}); check();
                controller.enqueue(chunk.value);
              } catch (cause) {controller.error(cause); void reader.cancel().catch(() => {});}
            },
            cancel: () => reader.cancel(),
          });
          try {
            // CacheStorage consumes the stream. No array of model chunks or
            // second full download buffer is assembled in JavaScript.
            await cache.put(urls[index],new Response(body,{headers:{'content-type':contentTypes[file.role]}})); check();
            await verify(await cache.match(urls[index]),file,attempt.generation); check();
          } finally {
            attempt.abort.signal.removeEventListener('abort',abortReader);
            // A quota failure can precede CacheStorage consuming the stream.
            // Cancel the source even on that path; releasing a lock alone does
            // not stop the fetch body.
            void reader.cancel().catch(() => {}); reader.releaseLock();
          }
        }
        const marker = {schemaVersion:1,manifestDigest,cacheName:attempt.name,resourceUrls:urls}; check();
        await cache.put(markerUrl,new Response(JSON.stringify(marker),{headers:{'content-type':'application/json'}})); check();
        attempt.committed = true; ready = true;
      } catch (cause) {if (attempt.generation !== generation || attempt.abort.signal.aborted) throw cancelled(); throw storageError(cause);}
      finally {
        if (!attempt.committed) {attempt.abort.abort(); await detach(attempt).catch(() => {});}
        if (active === attempt) active = undefined;
      }
    },
    load: async () => {
      const observed = generation; const deleted = deletionGeneration;
      let opened: string | undefined;
      try {
        await deleting; current(observed);
        const manifestDigest = await identity(); current(observed);
        const prefix = namespace + manifestDigest + ':';
        const names = (await ports.caches.keys()).filter(name => name.startsWith(prefix)).reverse(); current(observed);
        for (const name of names) {
          opened = name; const cache = await ports.caches.open(name); current(observed);
          const response = await cache.match(markerUrl); current(observed); if (!response) continue;
          let marker: unknown;
          try {marker = await response.json();} catch {throw error('integrity','模型就绪记录损坏，请删除后重新下载。');}
          current(observed);
          if (!marker || typeof marker !== 'object' || JSON.stringify(marker) !== JSON.stringify({schemaVersion:1,manifestDigest,cacheName:name,resourceUrls:urls})) throw error('integrity','模型版本或就绪记录不匹配。');
          const buffers = {} as Record<VoiceResourceRole, ArrayBuffer>;
          for (let index = 0; index < manifest.files.length; index++) {
            buffers[manifest.files[index].role] = await verify(await cache.match(urls[index]),manifest.files[index],observed);
          }
          current(observed); ready = true; return buffers;
        }
        throw error('missing','没有完整的模型下载；离线时请继续键盘输入。');
      } catch (cause) {
        if (deleted !== deletionGeneration && opened) await ports.caches.delete(opened).catch(() => {});
        if (observed !== generation) throw cancelled(); ready = false; throw storageError(cause);
      }
    },
  };
}
