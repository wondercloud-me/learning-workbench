import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {buildSync} from 'esbuild';
import {describe, expect, it} from 'vitest';
import resources from '../src/browser/voice/resources.json';

const path = '/learn/optional-asr/1.13.8/worker-test/';
const manifest = {
  schemaVersion: 1, buildId: 'worker-test', basePath: path, modelKind: 'senseVoice', runtimeVersion: '1.13.8',
  files: [...resources.files.map(file => ({role: file.role, filename: file.filename, url: path + file.filename,
    downloadUrl: file.role === 'model' || file.role === 'tokens' ? file.source : path + file.filename + '?wb-asr-download=1', bytes: file.bytes, sha256: file.sha256})),
    ...[['worker', 'runtime.worker.js'], ['worklet', 'capture.worklet.js']].map(([role, filename]) => ({role, filename, url: path + filename,
      downloadUrl: path + filename + '?wb-asr-download=1', bytes: 6, sha256: 'a'.repeat(64)}))],
};
// Allocation validates the real public sizes; fake FS never copies or touches weights.
// Recognition itself is substituted because actual WASM belongs to browser probes.
const buffers = {model: new ArrayBuffer(239233841), tokens: new ArrayBuffer(315894)};
function harness(options: {decodeThrows?: boolean; freeThrows?: boolean; raw?: string; deferred?: boolean} = {}) {
  const messages: any[] = [], calls: any[] = [];
  let finish: (() => void) | undefined;
  const worker: any = {location: new URL('https://fixture.example' + path + 'runtime.worker.js')};
  const module = {HEAPU8: new Uint8Array(16), FS: {writeFile(name: string, value: Uint8Array) {calls.push(['file', name, value.byteLength]);}}};
  const context: any = {self: worker, URL, Number, ArrayBuffer, Uint8Array, Float32Array, Math,
    postMessage(value: unknown) {messages.push(structuredClone(value));},
    importScripts(...urls: string[]) {calls.push(['imports', ...urls]);},
    SherpaOnnx: async (config: any) => {
      calls.push(['wasm-url', config.locateFile('sherpa-onnx-wasm-web.wasm')]);
      if (options.deferred) await new Promise<void>(resolve => {finish = resolve;});
      return module;
    },
    OfflineRecognizer: class {
      handle = 1;
      constructor(config: any) {calls.push(['config', structuredClone(config)]);}
      createStream() {calls.push(['stream']); return {
        acceptWaveform(rate: number, pcm: Float32Array) {calls.push(['audio', rate, Array.from(pcm)]);},
        free() {calls.push(['free']); if (options.freeThrows) throw Error('private cleanup detail');},
      };}
      decode() {calls.push(['decode']); if (options.decodeThrows) throw Error('private engine detail');}
      getResult() {return {text: options.raw ?? '函数接收参数并返回结果'};}
    },
  };
  const entry = new URL('../src/browser/voice/runtime.worker.ts', import.meta.url);
  readFileSync(entry); // Missing feature is the initial red condition.
  const script = buildSync({entryPoints: [fileURLToPath(entry)], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent'}).outputFiles[0].text;
  runInNewContext(script, context);
  const send = async (data: any) => {await worker.onmessage({data});};
  const init = () => send({type: 'init', requestId: 1, manifest: structuredClone(manifest), buffers});
  const transcribe = (pcm = new Float32Array([0.5, -0.5]), rate = 44100, id = 2) => send({type: 'transcribe', requestId: id, sampleRate: rate, pcm});
  return {messages, calls, send, init, transcribe, finish: () => finish?.()};
}

describe('external browser recognition worker boundary', () => {
  it('loads only fixed same-origin scripts, mounts validated sizes and configures one CPU SenseVoice recognizer', async () => {
    const worker = harness(); await worker.init();
    expect(worker.calls[0]).toEqual(['imports', 'https://fixture.example' + path + 'sherpa-onnx-wasm-web.js', 'https://fixture.example' + path + 'sherpa-onnx-asr.js']);
    expect(worker.calls).toContainEqual(['wasm-url', 'https://fixture.example' + path + 'sherpa-onnx-wasm-web.wasm']);
    expect(worker.calls).toContainEqual(['file', '/model.int8.onnx', 239233841]);
    expect(worker.calls).toContainEqual(['file', '/tokens.txt', 315894]);
    expect(worker.calls.find(item => item[0] === 'config')[1]).toEqual({featConfig: {sampleRate: 16000, featureDim: 80}, modelConfig: {
      tokens: '/tokens.txt', numThreads: 1, provider: 'cpu', debug: 0,
      senseVoice: {model: '/model.int8.onnx', language: '', useInverseTextNormalization: 1},
    }, decodingMethod: 'greedy_search'});
    expect(worker.messages.at(-1)).toMatchObject({type: 'ready', requestId: 1, heapBufferBytes: 16});
    await worker.transcribe();
    expect(worker.calls).toContainEqual(['audio', 44100, [0.5, -0.5]]);
    expect(worker.messages.at(-1)).toEqual({type: 'result', requestId: 2, text: '函数接收参数并返回结果'});
    expect(worker.calls.at(-1)).toEqual(['free']);
  });

  it.each(['kind', 'model-size', 'model-route', 'buffer-size'])('rejects altered %s before importing runtime or allocating the recognizer', async variant => {
    const worker = harness(); const changed = structuredClone(manifest);
    const input: any = {type: 'init', requestId: 1, manifest: changed, buffers};
    if (variant === 'kind') changed.modelKind = 'paraformer';
    if (variant === 'model-size') changed.files.find(item => item.role === 'model')!.bytes = 1;
    if (variant === 'model-route') changed.files.find(item => item.role === 'model')!.downloadUrl = 'https://unapproved.example/model';
    if (variant === 'buffer-size') input.buffers = {...buffers, model: new ArrayBuffer(1)};
    await worker.send(input);
    expect(worker.calls).toEqual([]);
    expect(worker.messages.at(-1)).toMatchObject({type: 'error', requestId: 1, code: 'initialization'});
  });

  it('refuses repeated initialization and replays of an already consumed transcription id', async () => {
    const worker = harness(); await worker.init(); await worker.init(); await worker.transcribe(); await worker.transcribe();
    expect(worker.calls.filter(item => item[0] === 'config')).toHaveLength(1);
    expect(worker.calls.filter(item => item[0] === 'decode')).toHaveLength(1);
    expect(worker.messages.filter(item => item.type === 'result')).toHaveLength(1);
  });

  it('allows the initial recording to share its init id, then consumes that transcription exactly once', async () => {
    const worker = harness(); await worker.init();
    await worker.transcribe(new Float32Array([0.5]), 16000, 1);
    expect(worker.messages.at(-1)).toEqual({type: 'result', requestId: 1, text: '函数接收参数并返回结果'});
    await worker.transcribe(new Float32Array([0.5]), 16000, 1);
    expect(worker.calls.filter(item => item[0] === 'decode')).toHaveLength(1);
    expect(worker.messages.filter(item => item.type === 'result')).toHaveLength(1);
  });

  it('does not construct a second model while the first initialization is awaiting WASM', async () => {
    const worker = harness({deferred: true}); const pending = worker.init();
    await worker.init();
    expect(worker.calls.filter(item => item[0] === 'imports')).toHaveLength(1);
    worker.finish(); await pending;
    expect(worker.calls.filter(item => item[0] === 'config')).toHaveLength(1);
    expect(worker.messages.at(-1)).toMatchObject({type: 'ready', requestId: 1});
  });

  it.each(['silence', 'empty', 'nan', 'range', 'rate', 'too-long'])('rejects invalid %s audio without invoking the model', async variant => {
    const worker = harness(); await worker.init();
    let pcm = new Float32Array([0.5]), rate = 8000;
    if (variant === 'silence') pcm.fill(0);
    if (variant === 'empty') pcm = new Float32Array();
    if (variant === 'nan') pcm[0] = NaN;
    if (variant === 'range') pcm[0] = 1.1;
    if (variant === 'rate') rate = 7999;
    if (variant === 'too-long') pcm = new Float32Array(240001);
    await worker.transcribe(pcm, rate);
    expect(worker.calls.some(item => item[0] === 'decode' || item[0] === 'stream')).toBe(false);
    expect(worker.messages.at(-1)).toMatchObject({type: 'error', requestId: 2, code: 'recognition'});
  });

  it.each(['decode', 'free', 'empty-result'])('cleans the stream and exposes a bounded error rather than a result when %s fails', async variant => {
    const worker = harness({decodeThrows: variant === 'decode', freeThrows: variant === 'free', raw: variant === 'empty-result' ? '' : undefined});
    await worker.init(); await worker.transcribe();
    expect(worker.calls.at(-1)).toEqual(['free']);
    expect(worker.messages.at(-1)).toEqual({type: 'error', requestId: 2, code: 'recognition'});
    expect(worker.messages.some(item => item.type === 'result')).toBe(false);
  });
});
