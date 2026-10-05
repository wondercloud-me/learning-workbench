import type {BrowserController} from '../controller';
import type {BrowserSnapshot} from '../../core/browser-state';
import {appendReviewedVoiceDraft, issueVoiceDraftRequest, previewVoiceDraft, retireVoiceDraftRequest} from './draft';
import {voiceManifestJson, type VoiceManifest} from './manifest';
import type {VoiceModelStore} from './model-store';
import type {BrowserVoiceLease, VoiceDraftPort, VoiceDraftPreview, VoiceDraftRequest, VoiceDraftTarget} from './types';

export type VoiceServicePhase = 'idle' | 'preparing' | 'permission' | 'recording' | 'flushing' | 'recognizing' | 'review' | 'error' | 'disposed';
export interface VoiceServiceSnapshot {
  readonly phase: VoiceServicePhase;
  readonly requestId: number | null;
  readonly preview: VoiceDraftPreview | null;
  readonly errorCode: string | null;
  readonly progress: 'runtime' | 'model' | null;
  readonly heapBufferBytes: number | null;
}
export interface VoiceServicePorts {
  controller: BrowserController;
  draftPort: VoiceDraftPort;
  reading: {stopAndConfirm(): boolean};
  resources: Pick<VoiceModelStore, 'status' | 'load'>;
  manifest: VoiceManifest;
  createWorker(): Worker;
  mediaDevices: Pick<MediaDevices, 'getUserMedia'>;
  createAudioContext(): AudioContext;
  createCaptureNode(context: AudioContext, captureId: number): Promise<AudioWorkletNode>;
  clock: {now(): number; setTimeout(callback: () => void, ms: number): unknown; clearTimeout(handle: unknown): void};
  lifecycle: {current(): boolean; subscribe(listener: () => void): () => void};
}
export interface BrowserVoiceService {
  snapshot(): VoiceServiceSnapshot;
  subscribe(listener: () => void): () => void;
  start(): {accepted: true; requestId: number} | {accepted: false; code: string};
  stop(): void;
  cancel(reason?: string): void;
  repreview(): VoiceDraftPreview;
  append(preview: VoiceDraftPreview): {applied: boolean; saving: Promise<BrowserSnapshot>};
  dispose(): void;
}
type Buffers = Awaited<ReturnType<VoiceModelStore['load']>>;
type PermissionTicket = {deliver: ((stream: MediaStream) => void) | null; reject: ((cause: unknown) => void) | null; cleanupFailed(): void};
type LoadTicket = {deliver: ((buffers: Buffers) => void) | null; reject: ((cause: unknown) => void) | null; done(): void};
const safely = (action: () => void) => {try {action(); return true;} catch {return false;}};
function stopTracks(stream: MediaStream): boolean {
  let clean = true;
  try {for (const track of stream.getTracks()) if (!safely(() => track.stop())) clean = false;} catch {clean = false;}
  return clean;
}
// These pending handlers capture only their disarmable ticket, never a Job.
function watchPermission(promise: Promise<MediaStream>, ticket: PermissionTicket) {
  void promise.then(stream => {
    const deliver = ticket.deliver; ticket.deliver = null; ticket.reject = null;
    if (deliver) {try {deliver(stream);} catch {if (!stopTracks(stream)) ticket.cleanupFailed();}}
    else if (!stopTracks(stream)) ticket.cleanupFailed();
  }, cause => {const reject = ticket.reject; ticket.deliver = null; ticket.reject = null; reject?.(cause);});
}
function watchLoad(promise: Promise<Buffers>, ticket: LoadTicket) {
  void promise.then(buffers => {
    const deliver = ticket.deliver; ticket.deliver = null; ticket.reject = null; ticket.done(); deliver?.(buffers);
  }, cause => {const reject = ticket.reject; ticket.deliver = null; ticket.reject = null; ticket.done(); reject?.(cause);});
}
type Binding = {worker: Worker; ready: boolean; idleTimer?: unknown; idleToken?: object; idleDeadline?: number};
type Job = {
  request: VoiceDraftRequest; target: VoiceDraftTarget | null; phase: VoiceServicePhase; acquiring: boolean;
  lease?: BrowserVoiceLease; context?: AudioContext; source?: MediaStreamAudioSourceNode; node?: AudioWorkletNode;
  stream?: MediaStream; permission?: PermissionTicket; load?: LoadTicket;
  resumed: boolean; nodeReady: boolean; binding?: Binding; nodeStarted: boolean;
  chunks: Float32Array[]; samples: number; sampleRate: number; limitSamples?: number;
  transcript: string | null; preview: VoiceDraftPreview | null; appending: boolean;
  timer?: unknown; timerToken?: object; deadline?: number;
};
const targetFields = ['page','learningView','columnId','sideId','mode','key','phase','stepId','documentGeneration','scopeVersion'] as const;

/** One transient recording owner. Construction never reads cache or creates audio/Worker. */
export function createBrowserVoiceService(ports: VoiceServicePorts): BrowserVoiceService {
  const manifest: VoiceManifest = JSON.parse(voiceManifestJson(ports.manifest));
  const listeners = new Set<() => void>();
  let disposed = false, tearingDown = false;
  // A removed reference is not confirmation that its native owner stopped.
  // This instance never allocates again after an unconfirmed teardown failure.
  let cleanupFailure: 'audio-cleanup' | 'worker-cleanup' | null = null;
  let starting: {cancelled: boolean} | undefined;
  let current: Job | undefined, worker: Binding | undefined, loading: LoadTicket | undefined;
  let closing: {context: AudioContext} | undefined, outcome: object | undefined;
  const state: { -readonly [K in keyof VoiceServiceSnapshot]: VoiceServiceSnapshot[K] } = {
    phase:'idle',requestId:null,preview:null,errorCode:null,progress:null,heapBufferBytes:null,
  };
  const emit = () => {for (const listener of [...listeners]) safely(listener);};
  const phase = (job: Job, next: VoiceServicePhase) => {job.phase = next; state.phase = next; state.progress = null;};
  function cleanupFailed(code: NonNullable<typeof cleanupFailure>) {
    cleanupFailure ??= code;
    if (!tearingDown) finish(cleanupFailure);
  }
  const audioCleanupFailed = () => cleanupFailed('audio-cleanup');
  function validTarget(target: VoiceDraftTarget | null): target is VoiceDraftTarget {
    if (!target) return false;
    try {
      const latest = ports.draftPort.target();
      if (!latest || !targetFields.every(key => target[key] === latest[key]) || !ports.draftPort.current(target)
        || !ports.lifecycle.current() || target.page !== 'learn' || target.learningView !== 'teaching'
        || !Number.isSafeInteger(target.scopeVersion) || target.scopeVersion < 0
        || target.documentGeneration !== ports.controller.documentGeneration()
        || ['conflict','unavailable'].includes(ports.controller.storageStatus())) return false;
      const document = ports.controller.pendingDocument(), column = document.state.columns.find(item => item.id === target.columnId);
      if (!document.state.onboarding.introSeen || !column || document.state.activeColumnId !== column.id || column.phase !== target.phase
        || (column.plan?.steps[column.currentStepIndex]?.id ?? null) !== target.stepId) return false;
      if (target.sideId !== null) return document.state.sideChats.some(side => side.id === target.sideId && side.columnId === target.columnId) && target.key === `question:side:${target.sideId}`;
      if (!['question','material','ai','learner'].includes(target.mode) || (target.mode === 'learner' && !['verify','teachback'].includes(target.phase))) return false;
      return target.key === `${target.mode === 'learner' ? target.phase === 'teachback' ? 'teachback' : 'answer' : target.mode}:${target.columnId}`;
    } catch {return false;}
  }
  function clearDeadline(job: Job) {
    job.timerToken = undefined; job.deadline = undefined;
    if (job.timer !== undefined) safely(() => ports.clock.clearTimeout(job.timer));
    job.timer = undefined;
  }
  function clearIdle(binding: Binding) {
    binding.idleToken = undefined;
    if (binding.idleTimer !== undefined) safely(() => ports.clock.clearTimeout(binding.idleTimer));
    binding.idleTimer = undefined;
  }
  function terminate(binding: Binding | undefined) {
    if (!binding) return;
    if (worker === binding) worker = undefined;
    clearIdle(binding);
    safely(() => {binding.worker.onmessage = null;}); safely(() => {binding.worker.onerror = null;}); safely(() => {binding.worker.onmessageerror = null;});
    if (!safely(() => binding.worker.terminate())) cleanupFailed('worker-cleanup');
  }
  function closeAudio(job: Job): boolean {
    const stream = job.stream, source = job.source, node = job.node, context = job.context;
    job.stream = undefined; job.source = undefined; job.node = undefined; job.context = undefined;
    let clean = !stream || stopTracks(stream);
    if (source && !safely(() => source.disconnect())) clean = false;
    if (node) {
      safely(() => {node.port.onmessage = null;}); safely(() => {node.port.onmessageerror = null;}); safely(() => {node.onprocessorerror = null;});
      if (!safely(() => node.disconnect())) clean = false;
      if (!safely(() => node.port.close())) clean = false;
    }
    if (context) {
      const ticket = {context}; closing = ticket;
      const completed = (failed: boolean) => {
        if (closing !== ticket) return;
        closing = undefined;
        let closed = false; safely(() => {closed = context.state === 'closed';});
        if (failed && !closed) cleanupFailed('audio-cleanup');
      };
      try {void context.close().then(() => completed(false), () => completed(true));}
      catch {completed(true); clean = false;}
    }
    if (!clean) cleanupFailed('audio-cleanup');
    return clean;
  }
  function finish(code: string | null, cancelWorker = true) {
    if (starting) starting.cancelled = true;
    tearingDown = true;
    const job = current; current = undefined; outcome = undefined;
    state.preview = null; state.requestId = null; state.progress = null;
    state.phase = disposed ? 'disposed' : code || cleanupFailure ? 'error' : 'idle'; state.errorCode = cleanupFailure ?? code;
    if (job) {
      clearDeadline(job);
      if (job.permission) {job.permission.deliver = null; job.permission.reject = null; job.permission = undefined;}
      if (job.load) {job.load.deliver = null; job.load.reject = null; job.load = undefined;}
      retireVoiceDraftRequest(job.request); job.target = null; job.preview = null; job.transcript = null; job.chunks = [];
      if (job.node) safely(() => job.node!.port.postMessage({type:'cancel',captureId:job.request.requestId}));
      // Install the closing ticket before releasing a lease can emit reentrant starts.
      closeAudio(job);
      const lease = job.lease; job.lease = undefined;
      if (cancelWorker) terminate(worker);
      lease?.release();
    } else if (cancelWorker) terminate(worker);
    state.phase = disposed ? 'disposed' : code || cleanupFailure ? 'error' : 'idle'; state.errorCode = cleanupFailure ?? code;
    tearingDown = false; emit();
  }
  function owned(job: Job): boolean {
    if (current !== job || disposed) return false;
    const targetValid = validTarget(job.target);
    // Injected guards may synchronously cancel and start a different request.
    if (current !== job || disposed) return false;
    const leaseValid = job.acquiring || job.phase === 'review' || job.lease?.current();
    if (current !== job || disposed) return false;
    if (!targetValid || !leaseValid) {finish(null); return false;}
    return true;
  }
  function guard(job: Job): boolean {
    if (!owned(job)) return false;
    const now = ports.clock.now();
    if (current !== job || disposed) return false;
    if (job.deadline !== undefined && now >= job.deadline) {
      if (job.phase === 'recording') stopRecording(job);
      else finish(`${job.phase}-timeout`);
    }
    return current === job;
  }
  function arm(job: Job, milliseconds: number) {
    clearDeadline(job); const token = {}; job.timerToken = token; job.deadline = ports.clock.now() + milliseconds;
    const callback = () => {
      if (current !== job || job.timerToken !== token) return;
      if (ports.clock.now() < job.deadline!) {job.timer = ports.clock.setTimeout(callback, job.deadline! - ports.clock.now()); return;}
      guard(job);
    };
    job.timer = ports.clock.setTimeout(callback, milliseconds);
  }
  function idle(binding: Binding) {
    clearIdle(binding); const token = {}; binding.idleToken = token; binding.idleDeadline = ports.clock.now() + 60000;
    const callback = () => {
      if (worker !== binding || binding.idleToken !== token || (current && current.phase !== 'review')) return;
      const remaining = binding.idleDeadline! - ports.clock.now();
      if (remaining > 0) {binding.idleTimer = ports.clock.setTimeout(callback,remaining); return;}
      terminate(binding);
    };
    binding.idleTimer = ports.clock.setTimeout(callback,60000);
  }
  function deliverResult(job: Job, text: unknown) {
    if (!guard(job) || job.phase !== 'recognizing') return;
    if (typeof text !== 'string' || !text.trim() || text.length > 20000) {finish('recognition'); return;}
    try {
      const preview = previewVoiceDraft(job.request,text,ports.controller,ports.draftPort);
      clearDeadline(job); job.transcript = text; job.preview = preview; phase(job,'review'); state.preview = preview;
      const lease = job.lease; job.lease = undefined; lease?.release();
      if (!owned(job)) return;
      if (worker) idle(worker); emit();
    } catch {if (current === job) finish('draft-target');}
  }
  function captureMessage(job: Job, node: AudioWorkletNode, data: unknown) {
    if (job.node !== node || !guard(job) || !['recording','flushing'].includes(job.phase) || !data || typeof data !== 'object') return;
    const message = data as Record<string, unknown>;
    if (message.captureId !== job.request.requestId) return;
    if (message.type === 'error') {finish('audio-capture'); return;}
    if (message.type === 'pcm') {
      const pcm = message.pcm;
      if (message.sampleRate !== job.sampleRate || !(pcm instanceof Float32Array) || !pcm.length || pcm.length > 2048
        || message.totalSamples !== job.samples + pcm.length || job.samples + pcm.length > Math.floor(job.sampleRate * 30)
        || pcm.some(value => !Number.isFinite(value) || Math.abs(value) > 1)) {finish('invalid-pcm'); return;}
      job.chunks.push(pcm); job.samples += pcm.length; return;
    }
    if (message.type === 'limit') {
      if (message.totalSamples !== Math.floor(job.sampleRate * 30)) {finish('invalid-pcm'); return;}
      job.limitSamples = message.totalSamples as number;
      if (job.phase === 'recording') stopRecording(job);
      return;
    }
    if (message.type === 'flushed' && job.phase === 'flushing') {
      if (message.sampleRate !== job.sampleRate || message.totalSamples !== job.samples || !job.samples
        || (job.limitSamples !== undefined && job.samples !== job.limitSamples)) {finish('invalid-pcm'); return;}
      try {
        const pcm = new Float32Array(job.samples); let offset = 0;
        for (const chunk of job.chunks) {pcm.set(chunk,offset); offset += chunk.length;}
        job.chunks = [];
        if (!closeAudio(job)) {finish('audio-cleanup'); return;}
        if (!guard(job)) return;
        phase(job,'recognizing'); arm(job,60000);
        job.binding!.worker.postMessage({type:'transcribe',requestId:job.request.requestId,sampleRate:job.sampleRate,pcm},[pcm.buffer]);
        if (guard(job)) emit();
      } catch {if (current === job) finish('recognition');}
    }
  }
  function stopRecording(job: Job) {
    if (!owned(job) || job.phase !== 'recording') return;
    const stream = job.stream; job.stream = undefined;
    const clean = !stream || stopTracks(stream);
    if (!clean) {cleanupFailed('audio-cleanup'); return;}
    if (!owned(job)) return;
    phase(job,'flushing'); arm(job,500);
    try {job.node!.port.postMessage({type:'flush',captureId:job.request.requestId}); if (current === job) emit();}
    catch {if (current === job) finish('audio-capture');}
  }
  function requestPermission(job: Job) {
    if (!guard(job) || job.phase !== 'preparing' || !job.resumed || !job.nodeReady || !job.binding?.ready) return;
    phase(job,'permission'); arm(job,30000);
    const ticket: PermissionTicket = {
      deliver: stream => {
        job.permission = undefined;
        if (!guard(job) || job.phase !== 'permission') {if (!stopTracks(stream)) cleanupFailed('audio-cleanup'); return;}
        job.stream = stream;
        try {
          job.source = job.context!.createMediaStreamSource(stream);
          if (!guard(job)) return;
          job.source.connect(job.node!); job.node!.connect(job.context!.destination);
          if (!guard(job)) return;
          phase(job,'recording'); arm(job,30000); emit();
        } catch {if (current === job) finish('audio-graph');}
      },
      reject: () => {job.permission = undefined; if (guard(job)) finish('permission');},
      cleanupFailed: audioCleanupFailed,
    };
    job.permission = ticket;
    try {const promise = ports.mediaDevices.getUserMedia({audio:true,video:false}); watchPermission(promise,ticket); if (current === job) emit();}
    catch {if (current === job) finish('permission');}
  }
  function prepareNode(job: Job) {
    if (!guard(job) || job.nodeStarted || !job.binding?.ready) return;
    job.nodeStarted = true;
    try {
      void ports.createCaptureNode(job.context!,job.request.requestId).then(node => {
        if (!guard(job)) {
          const disconnected = safely(() => node.disconnect()), closed = safely(() => node.port.close());
          if (!disconnected || !closed) cleanupFailed('audio-cleanup');
          return;
        }
        job.node = node;
        node.port.onmessage = event => captureMessage(job,node,event.data);
        node.port.onmessageerror = () => {if (guard(job)) finish('audio-capture');};
        node.onprocessorerror = () => {if (guard(job)) finish('audio-capture');};
        job.nodeReady = true; requestPermission(job);
      }, () => {if (guard(job)) finish('audio-graph');});
    } catch {if (current === job) finish('audio-graph');}
  }
  function initialize(job: Job, buffers: Buffers) {
    if (!guard(job)) return;
    try {
      const binding: Binding = {worker:ports.createWorker(),ready:false};
      if (!guard(job)) {terminate(binding); return;}
      worker = binding; job.binding = binding;
      const fault = () => {if (worker !== binding) return; if (current?.phase === 'review') {terminate(binding);return;} if (current) finish('worker-error');else terminate(binding);};
      binding.worker.onerror = fault; binding.worker.onmessageerror = fault;
      binding.worker.onmessage = event => {
        if (worker !== binding || current !== job || !guard(job) || !event.data || typeof event.data !== 'object') return;
        const data = event.data as Record<string, unknown>;
        if (data.requestId !== job.request.requestId) return;
        if (data.type === 'error') {finish(data.code === 'initialization' || data.code === 'recognition' ? data.code : 'worker-protocol'); return;}
        if (data.type === 'progress' && job.phase === 'preparing' && (data.stage === 'runtime' || data.stage === 'model')) {state.progress = data.stage; emit();}
        if (data.type === 'ready' && job.phase === 'preparing' && !binding.ready) {
          if (!Number.isSafeInteger(data.heapBufferBytes) || (data.heapBufferBytes as number) <= 0) {finish('worker-protocol'); return;}
          binding.ready = true; state.heapBufferBytes = data.heapBufferBytes as number; prepareNode(job);
        }
        if (data.type === 'result') deliverResult(job,data.text);
      };
      if (!(buffers.model instanceof ArrayBuffer) || !(buffers.tokens instanceof ArrayBuffer)) {finish('resources'); return;}
      binding.worker.postMessage({type:'init',requestId:job.request.requestId,manifest,buffers:{model:buffers.model,tokens:buffers.tokens}},[buffers.model,buffers.tokens]);
    } catch {if (current === job) finish('initialization');}
  }
  function prepare(job: Job, resumed: Promise<void>) {
    void resumed.then(() => {if (guard(job)) {job.resumed = true; requestPermission(job);}}, () => {if (guard(job)) finish('audio-graph');});
    if (!guard(job)) return;
    if (worker?.ready) {
      clearIdle(worker); job.binding = worker;
      // Rebind the warm worker to this job: old closures cannot deliver results.
      const binding = worker;
      binding.worker.onmessage = event => {
        if (worker !== binding || !guard(job) || !event.data || typeof event.data !== 'object') return;
        const data = event.data as Record<string,unknown>;
        if (data.requestId !== job.request.requestId) return;
        if (data.type === 'error') finish('recognition');
        else if (data.type === 'result') deliverResult(job,data.text);
      };
      prepareNode(job); return;
    }
    const ticket: LoadTicket = {deliver:buffers=>{job.load=undefined;initialize(job,buffers);},reject:()=>{job.load=undefined;if (guard(job)) finish('resources');},done:()=>{if (loading === ticket) loading=undefined;}};
    loading = ticket; job.load = ticket;
    try {watchLoad(ports.resources.load(),ticket);} catch {ticket.done(); if (current === job) finish('resources');}
  }
  const invalidate = () => {if (current) owned(current); else if (!ports.lifecycle.current()) finish(null);};
  const unsubscribeController = ports.controller.subscribe(invalidate), unsubscribeLifecycle = ports.lifecycle.subscribe(invalidate);
  return {
    snapshot: () => Object.freeze({...state}),
    subscribe(listener) {if (disposed) return () => {}; listeners.add(listener); return () => {listeners.delete(listener);};},
    start() {
      if (disposed || starting || tearingDown || current || loading || closing || cleanupFailure) return {accepted:false,code:disposed?'disposed':cleanupFailure ?? 'busy'};
      const ticket = {cancelled:false}; starting = ticket;
      let job: Job | undefined;
      try {
        const target = ports.draftPort.target(), targetValid = validTarget(target), composing = ports.draftPort.composing();
        if (ticket.cancelled || disposed) return {accepted:false,code:'cancelled'};
        if (!targetValid || !target || composing) return {accepted:false,code:'draft-target'};
        const status = ports.resources.status();
        if (ticket.cancelled || disposed) return {accepted:false,code:'cancelled'};
        if (status !== 'ready') return {accepted:false,code:'missing'};
        const request = issueVoiceDraftRequest(ports.controller,target);
        job = {
          request,target:Object.freeze({...target}),phase:'preparing',acquiring:true,resumed:false,nodeReady:false,nodeStarted:false,
          chunks:[],samples:0,sampleRate:0,transcript:null,preview:null,appending:false,
        };
        current = job; outcome = undefined; state.requestId = request.requestId; state.preview = null; state.errorCode = null; phase(job,'preparing');
        job.lease = ports.controller.acquireVoiceOperation(); job.acquiring = false;
        if (current !== job) {job.lease.release(); job.lease = undefined; return {accepted:false,code:'cancelled'};}
        if (!owned(job)) return {accepted:false,code:'cancelled'};
        if (!ports.reading.stopAndConfirm()) {finish('reading-stop'); return {accepted:false,code:'reading-stop'};}
        if (!owned(job)) return {accepted:false,code:'cancelled'};
        if (worker) clearIdle(worker);
        job.context = ports.createAudioContext();
        if (!owned(job)) {closeAudio(job); return {accepted:false,code:'cancelled'};}
        job.sampleRate = job.context.sampleRate;
        if (!Number.isFinite(job.sampleRate) || job.sampleRate < 8000 || job.sampleRate > 96000) {finish('audio-rate'); return {accepted:false,code:'audio-rate'};}
        const resumed = job.context.resume();
        if (!owned(job)) {void resumed.catch(() => {}); return {accepted:false,code:'cancelled'};}
        arm(job,120000); prepare(job,resumed); if (current === job) emit();
        return current === job ? {accepted:true,requestId:request.requestId} : {accepted:false,code:'cancelled'};
      } catch {if (job && current === job) finish('start'); return {accepted:false,code:'start'};}
      finally {if (starting === ticket) starting = undefined;}
    },
    stop() {if (current) stopRecording(current);},
    cancel: () => finish(null),
    repreview() {
      const job = current;
      if (!job || job.phase !== 'review' || !owned(job) || !job.transcript) throw Error('没有当前可检查的识别结果。');
      const preview = previewVoiceDraft(job.request,job.transcript,ports.controller,ports.draftPort);
      job.preview = preview; state.preview = preview; state.errorCode = null; emit(); return preview;
    },
    append(preview) {
      const job = current;
      if (!job || job.phase !== 'review' || job.appending || job.preview !== preview || !owned(job)) return {applied:false,saving:Promise.reject<BrowserSnapshot>(Error('语音预览已失效。'))};
      job.appending = true;
      const result = appendReviewedVoiceDraft(preview,ports.controller,ports.draftPort);
      if (!result.applied) {job.appending = false; return result;}
      const token = {}; outcome = token;
      retireVoiceDraftRequest(job.request); job.target = null; job.transcript = null; job.preview = null; current = undefined;
      state.preview = null; state.requestId = null; state.phase = 'idle'; emit();
      const saving = result.saving.catch(cause => {if (!disposed && outcome === token) {state.errorCode = 'save-failed'; state.phase = 'error'; emit();} throw cause;});
      return {applied:true,saving};
    },
    dispose() {if (disposed) return; disposed = true; finish(null); safely(unsubscribeController); safely(unsubscribeLifecycle); listeners.clear();},
  };
}
