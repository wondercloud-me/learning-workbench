import type {BrowserController} from '../controller';
import {validateVoiceManifest, VOICE_RESOURCES, type VoiceManifest} from './manifest';
import {createVoiceModelStore, type VoiceDownloadProgress, type VoiceModelStore} from './model-store';
import {createBrowserVoicePlatform} from './platform';
import {createBrowserVoiceService, type BrowserVoiceService, type VoiceServiceSnapshot} from './service';
import type {VoiceDraftPort, VoiceDraftPreview, VoiceDraftTarget} from './types';

export type VoiceResourceOperation = 'checking' | 'downloading' | 'verifying' | 'deleting';
export interface BrowserVoiceSnapshot {
  manifest: VoiceManifest | null; ready: boolean; operation: VoiceResourceOperation | null;
  progress: VoiceDownloadProgress | null; error: string; notice: string; service: VoiceServiceSnapshot | null;
}
const sameTarget = (left: VoiceDraftTarget | null, right: VoiceDraftTarget | null) => left !== null && right !== null && Object.keys(left).every(key => left[key as keyof VoiceDraftTarget] === right[key as keyof VoiceDraftTarget]);
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

/** One App owner. Construction performs no optional resource or native operation. */
export function createBrowserVoiceCoordinator(ports: {enabled: boolean; base: string; buildId: string; controller: BrowserController; eligible(): boolean; resourceAllowed(): boolean; stopReading(): boolean}) {
  const listeners = new Set<() => void>();
  let disposed = false, version = 0, binding: VoiceDraftPort | null = null;
  let store: VoiceModelStore | undefined, service: BrowserVoiceService | undefined, unsubscribe: (() => void) | undefined;
  let attempt: {kind: VoiceResourceOperation; cancelled: boolean; abort: AbortController} | undefined;
  const state: BrowserVoiceSnapshot = {manifest:null,ready:false,operation:null,progress:null,error:'',notice:'',service:null};
  const emit = () => {if (!disposed) for (const listener of [...listeners]) listener();};
  const sync = () => {state.service = service?.snapshot() ?? null; state.ready = store?.status() === 'ready'; emit();};
  const draftPort: VoiceDraftPort = {
    target: () => ports.eligible() ? binding?.target() ?? null : null,
    current: target => ports.eligible() && !!binding?.current(target),
    composing: () => binding?.composing() ?? false,
  };
  const current = (observed: NonNullable<typeof attempt>) => !disposed && attempt === observed && !observed.cancelled;
  async function operation(kind: VoiceResourceOperation, run: (observed: NonNullable<typeof attempt>) => Promise<void>) {
    if (!ports.enabled || disposed || attempt || !ports.resourceAllowed()) return;
    const observed = {kind,cancelled:false,abort:new AbortController()}; attempt = observed;
    state.operation = kind; state.progress = null; state.error = ''; state.notice = ''; emit();
    try {await run(observed);} catch (cause) {if (current(observed)) state.error = message(cause);}
    finally {if (attempt === observed) {attempt = undefined; state.operation = null; sync();}}
  }
  const cancel = () => {service?.cancel(); sync();};
  const scope = () => {version++; cancel();};
  async function cancelResources() {
    const observed = attempt;
    if (observed) {observed.cancelled = true; observed.abort.abort();}
    try {await store?.cancel();} catch (cause) {state.error = message(cause);}
    if (attempt === observed) {attempt = undefined; state.operation = null; state.progress = null; sync();}
  }
  return {
    enabled: ports.enabled,
    snapshot: (): BrowserVoiceSnapshot => ({...state}),
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    version: () => version,
    resourceAllowed: () => ports.enabled && !disposed && ports.resourceAllowed(),
    busy: () => !!attempt,
    scope, cancel,
    beforeRead() {
      cancel();
      if (['audio-cleanup','worker-cleanup'].includes(service?.snapshot().errorCode ?? '')) throw Error('语音资源未能停止，请重新加载页面后再朗读。');
    },
    invalidate() {const target = binding?.target() ?? null; if (service?.snapshot().requestId !== null && (!target || !draftPort.current(target))) cancel();},
    release(port: VoiceDraftPort) {if (binding === port) {scope(); binding = null;}},
    start(port: VoiceDraftPort, expected: VoiceDraftTarget) {
      if (disposed || attempt || !ports.enabled || !ports.eligible() || !port.current(expected) || !sameTarget(expected,port.target())) return;
      if (service?.snapshot().requestId != null) return;
      binding = port; state.error = ''; state.notice = '';
      const result = service?.start();
      if (!result || !result.accepted) state.error = result?.code === 'audio-cleanup' || result?.code === 'worker-cleanup' ? '语音资源未能停止，请重新加载页面后再使用。' : '本地语音暂不可用，请先检查并下载资源，或继续键盘输入。';
      sync();
    },
    stop(port: VoiceDraftPort) {if (binding === port) service?.stop();},
    repreview(port: VoiceDraftPort, expected: VoiceDraftTarget) {
      if (binding !== port || !port.current(expected)) return;
      try {service?.repreview(); state.error = ''; state.notice = '';} catch (cause) {state.error = message(cause);} sync();
    },
    append(port: VoiceDraftPort, expected: VoiceDraftTarget, preview: VoiceDraftPreview) {
      if (binding !== port || !port.current(expected) || !service) return;
      const result = service.append(preview);
      void result.saving.then(() => {if (!disposed) {state.notice = result.applied ? '已追加到草稿。检查后可自行发送或保存。' : ''; sync();}}, cause => {
        if (!disposed) {state.error = result.applied ? '文字已在当前草稿中，尚未保存；请仅重试保存，不要再次追加。' : message(cause); sync();}
      });
      sync();
    },
    check: () => operation('checking',async observed => {
      if (state.manifest) return;
      const appBase = new URL(ports.base,window.location.href).href;
      const url = new URL(`optional-asr/${VOICE_RESOURCES.runtime.version}/${ports.buildId}/resources.json`,appBase);
      const response = await fetch(url.href,{credentials:'omit',redirect:'error',cache:'no-store',signal:observed.abort.signal});
      if (!current(observed)) return;
      if (!response.ok || ['opaque','opaqueredirect'].includes(response.type) || response.url && new URL(response.url).origin !== url.origin) throw Error('语音资源清单不可用，请继续键盘输入。');
      const text = await response.text(); if (!current(observed)) return;
      if (text.length > 32768) throw Error('语音资源清单不符合预期。');
      const manifest = validateVoiceManifest(JSON.parse(text),appBase);
      if (manifest.buildId !== ports.buildId) throw Error('语音资源版本不符合当前页面。');
      // Preserve this service instance, including its sticky cleanup failure.
      store = createVoiceModelStore(manifest,{caches:globalThis.caches,fetch:(input,init)=>fetch(input,init),crypto:globalThis.crypto,origin:window.location.origin,generationId:()=>crypto.randomUUID()});
      const platform = createBrowserVoicePlatform(manifest,appBase,ports.eligible);
      service = createBrowserVoiceService({...platform,manifest,controller:ports.controller,draftPort,resources:store,reading:{stopAndConfirm:ports.stopReading}});
      unsubscribe = service.subscribe(sync); state.manifest = manifest; sync();
    }),
    download: () => operation('downloading',async observed => {
      if (!store) throw Error('先检查本地语音资源。'); cancel();
      await store.download(progress => {if (current(observed)) {state.progress = progress; emit();}});
      if (current(observed)) state.notice = '本地语音资源已下载并校验。';
    }),
    verify: () => operation('verifying',async observed => {
      if (!store) throw Error('先检查本地语音资源。'); cancel();
      await store.load(); if (current(observed)) state.notice = '已有模型缓存已重新校验。';
    }),
    delete: () => operation('deleting',async observed => {
      scope(); state.ready = false;
      if (!store) throw Error('先检查本地语音资源。');
      await store.delete(); if (current(observed)) state.notice = '已删除可选语音下载。';
    }),
    cancelResources,
    dispose() {if (disposed) return; disposed = true; scope(); void cancelResources(); unsubscribe?.(); service?.dispose(); binding = null; listeners.clear();},
  };
}
export type BrowserVoiceCoordinator = ReturnType<typeof createBrowserVoiceCoordinator>;
