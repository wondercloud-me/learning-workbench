import {validateVoiceManifest, type VoiceManifest, type VoiceResourceRole} from './manifest';

interface RecognitionStream {acceptWaveform(rate: number, pcm: Float32Array): void; free(): void;}
interface Recognizer {handle: number; createStream(): RecognitionStream; decode(stream: RecognitionStream): void; getResult(stream: RecognitionStream): {text: string};}
interface Engine {HEAPU8: Uint8Array; FS: {writeFile(path: string, bytes: Uint8Array, options: {canOwn: boolean}): void};}
declare const self: {location: {href: string}; onmessage: (event: {data: unknown}) => Promise<void>};
declare function importScripts(...urls: string[]): void;
declare function postMessage(value: unknown): void;
declare function SherpaOnnx(config: {locateFile(name: string): string; print(): void; printErr(): void}): Promise<Engine>;
declare const OfflineRecognizer: new (config: unknown, engine: Engine) => Recognizer;

let initializationStarted = false;
let recognizer: Recognizer | null = null;
let lastRequestId = -1;
const error = (requestId: number, code: 'initialization' | 'recognition') => postMessage({type: 'error', requestId, code});

function workerBase(): string {
  const location = new URL(self.location.href);
  const match = location.pathname.match(/^(\/(?:[A-Za-z0-9_-]+\/)*)optional-asr\/1\.13\.8\/[A-Za-z0-9_-]+\/runtime\.worker\.js$/);
  if (!match || location.search || location.hash || !['http:', 'https:'].includes(location.protocol)) throw Error('Invalid worker location');
  return location.origin + match[1];
}
function resourceUrl(manifest: VoiceManifest, role: VoiceResourceRole): string {
  return new URL(manifest.files.find(file => file.role === role)!.url, self.location.href).href;
}
async function initialize(requestId: number, data: Record<string, unknown>) {
  if (initializationStarted) {error(requestId, 'initialization'); return;}
  initializationStarted = true;
  // init does not consume the recording: its first transcribe may use this id.
  lastRequestId = requestId - 1;
  try {
    const manifest = validateVoiceManifest(data.manifest, workerBase());
    if (resourceUrl(manifest, 'worker') !== self.location.href) throw Error('Wrong build worker');
    const buffers = data.buffers as {model?: unknown; tokens?: unknown} | undefined;
    for (const role of ['model', 'tokens'] as const) {
      if (!(buffers?.[role] instanceof ArrayBuffer) || buffers[role].byteLength !== manifest.files.find(file => file.role === role)!.bytes) throw Error('Invalid model buffers');
    }
    // Cache hashes are checked by model-store before the caller transfers these buffers.
    // Do not allocate the fixed 512 MiB WASM heap before metadata/size checks.
    postMessage({type: 'progress', requestId, stage: 'runtime'});
    importScripts(resourceUrl(manifest, 'glue'), resourceUrl(manifest, 'wrapper'));
    const wasm = manifest.files.find(file => file.role === 'wasm')!;
    const engine = await SherpaOnnx({
      locateFile: name => {if (name !== wasm.filename) throw Error('Unexpected runtime resource'); return resourceUrl(manifest, 'wasm');},
      print: () => {}, printErr: () => {},
    });
    postMessage({type: 'progress', requestId, stage: 'model'});
    engine.FS.writeFile('/model.int8.onnx', new Uint8Array(buffers!.model as ArrayBuffer), {canOwn: true});
    engine.FS.writeFile('/tokens.txt', new Uint8Array(buffers!.tokens as ArrayBuffer), {canOwn: true});
    const next = new OfflineRecognizer({
      featConfig: {sampleRate: 16000, featureDim: 80},
      modelConfig: {tokens: '/tokens.txt', numThreads: 1, provider: 'cpu', debug: 0,
        senseVoice: {model: '/model.int8.onnx', language: '', useInverseTextNormalization: 1}},
      decodingMethod: 'greedy_search',
    }, engine);
    if (!next.handle) throw Error('Recognizer unavailable');
    recognizer = next;
    postMessage({type: 'ready', requestId, heapBufferBytes: engine.HEAPU8.buffer.byteLength});
  } catch {recognizer = null; error(requestId, 'initialization');}
}
function transcribe(requestId: number, data: Record<string, unknown>) {
  if (!recognizer || requestId <= lastRequestId) {error(requestId, 'recognition'); return;}
  // Consume even failed requests; a caller cannot replay audio under the same id.
  lastRequestId = requestId;
  try {
    const rate = data.sampleRate, pcm = data.pcm;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 8000 || rate > 96000
      || !(pcm instanceof Float32Array) || !pcm.length || pcm.length > Math.floor(rate * 30)) throw Error('Invalid audio');
    let peak = 0;
    for (const value of pcm) {
      if (!Number.isFinite(value) || Math.abs(value) > 1) throw Error('Invalid audio');
      peak = Math.max(peak, Math.abs(value));
    }
    if (peak < 1e-7) throw Error('No speech');
    let stream: RecognitionStream | undefined;
    let text: string;
    try {
      stream = recognizer.createStream();
      stream.acceptWaveform(rate, pcm);
      recognizer.decode(stream);
      text = recognizer.getResult(stream).text;
      if (typeof text !== 'string' || !text.trim() || text.length > 20000) throw Error('No text');
    } finally {stream?.free();}
    postMessage({type: 'result', requestId, text});
  } catch {error(requestId, 'recognition');}
}
self.onmessage = async event => {
  if (!event.data || typeof event.data !== 'object') return;
  const data = event.data as Record<string, unknown>, requestId = data.requestId;
  if (typeof requestId !== 'number' || !Number.isSafeInteger(requestId) || requestId < 0) return;
  if (data.type === 'init') await initialize(requestId, data);
  else if (data.type === 'transcribe') transcribe(requestId, data);
};
