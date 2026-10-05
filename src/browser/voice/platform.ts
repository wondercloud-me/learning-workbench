import {validateVoiceManifest, type VoiceManifest} from './manifest';
import type {VoiceServicePorts} from './service';

/** Browser primitives are lazy: construction never asks for a device or model. */
export interface BrowserVoiceEnvironment {
 readonly origin: string;
 readonly isSecureContext: boolean;
 readonly document: EventTarget & {readonly visibilityState: string};
 readonly window: EventTarget;
 readonly Worker?: new (url: string, options?: WorkerOptions) => Worker;
 readonly AudioContext?: new () => AudioContext;
 readonly AudioWorkletNode?: new (context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) => AudioWorkletNode;
 readonly mediaDevices?: Pick<MediaDevices, 'getUserMedia'>;
 readonly performance: Pick<Performance, 'now'>;
 setTimeout(callback: () => void, ms: number): unknown;
 clearTimeout(handle: unknown): void;
}
export type BrowserVoicePlatform = Pick<VoiceServicePorts, 'createWorker' | 'createAudioContext' | 'createCaptureNode' | 'mediaDevices' | 'clock' | 'lifecycle'>;
const unsupported = () => new Error('此浏览器暂不支持本地语音输入，请继续键盘输入。');
function browserEnvironment(): BrowserVoiceEnvironment {
 if (typeof window === 'undefined' || typeof document === 'undefined' || typeof navigator === 'undefined') throw unsupported();
 return {
  origin: window.location.origin, isSecureContext: window.isSecureContext, document, window,
  Worker: typeof Worker === 'undefined' ? undefined : Worker,
  AudioContext: typeof AudioContext === 'undefined' ? undefined : AudioContext,
  AudioWorkletNode: typeof AudioWorkletNode === 'undefined' ? undefined : AudioWorkletNode,
  mediaDevices: navigator.mediaDevices, performance,
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: handle => window.clearTimeout(handle as number),
 };
}

/** Only receives validated deployment metadata; resource bytes stay in the store. */
export function createBrowserVoicePlatform(input: VoiceManifest, appBase: string, eligible: () => boolean, host = browserEnvironment()): BrowserVoicePlatform {
 const manifest = validateVoiceManifest(input, appBase);
 const WorkerConstructor = host.Worker, ContextConstructor = host.AudioContext, CaptureConstructor = host.AudioWorkletNode, media = host.mediaDevices;
 if (!host.isSecureContext || !WorkerConstructor || !ContextConstructor || !CaptureConstructor || !media?.getUserMedia) throw unsupported();
 const origin = new URL(host.origin).origin;
 const url = (role: 'worker' | 'worklet') => new URL(manifest.files.find(file => file.role === role)!.url, origin).href;
 const workerUrl = url('worker'), workletUrl = url('worklet');
 let pageHidden = false;
 return {
  createWorker: () => new WorkerConstructor(workerUrl, {type: 'classic', name: 'workbench-local-voice'}),
  createAudioContext: () => new ContextConstructor(),
  createCaptureNode: async (context, captureId) => {
   if (!Number.isSafeInteger(captureId) || captureId < 0) throw unsupported();
   await context.audioWorklet.addModule(workletUrl);
   return new CaptureConstructor(context, 'workbench-voice-capture', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: {captureId},
   });
  },
  mediaDevices: {getUserMedia: constraints => media.getUserMedia(constraints)},
  clock: {now: () => host.performance.now(), setTimeout: (callback, ms) => host.setTimeout(callback, ms), clearTimeout: handle => host.clearTimeout(handle)},
  lifecycle: {
   current: () => !pageHidden && host.document.visibilityState === 'visible' && eligible(),
   subscribe: listener => {
    const visibility = () => listener();
    const hide = () => {pageHidden = true; listener();};
    const show = () => {pageHidden = false; listener();};
    host.document.addEventListener('visibilitychange', visibility);
    host.window.addEventListener('pagehide', hide); host.window.addEventListener('pageshow', show);
    let detached = false;
    return () => {
     if (detached) return; detached = true;
     host.document.removeEventListener('visibilitychange', visibility);
     host.window.removeEventListener('pagehide', hide); host.window.removeEventListener('pageshow', show);
    };
   },
  },
 };
}
