import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
import {describe, expect, it} from 'vitest';

// Execute the external worklet, substituting only the browser-owned port/globals.
// Wrong truncation, stale IDs, missing final flush, or speaker output fail here.
function capture(rate = 48000, captureId = 7) {
  const output: any[] = [];
  let Processor: any;
  const port = {
    onmessage: null as null | ((event: {data: unknown}) => void),
    postMessage(value: any, transfer: ArrayBuffer[] = []) {
      output.push(structuredClone(value, {transfer}));
    },
  };
  const source = readFileSync(new URL('../src/browser/voice/capture.worklet.ts', import.meta.url), 'utf8');
  const script = transformSync(source, {loader: 'ts', format: 'iife', target: 'es2022'}).code;
  runInNewContext(script, {
    sampleRate: rate, Float32Array, Number, Array, Math,
    AudioWorkletProcessor: class {port = port;},
    registerProcessor(name: string, value: any) {expect(name).toBe('workbench-voice-capture'); Processor = value;},
  });
  const processor = new Processor({processorOptions: {captureId}});
  const process = (channels: Float32Array[]) => {
    const speakers = [new Float32Array(channels[0]?.length ?? 128).fill(1)];
    processor.process([channels], [speakers], {});
    expect(Array.from(speakers[0])).toEqual(Array(speakers[0].length).fill(0));
  };
  const message = (type: string, id = captureId) => port.onmessage?.({data: {type, captureId: id}});
  const pcm = () => output.filter(item => item.type === 'pcm');
  return {output, process, message, pcm};
}

describe('bounded browser microphone worklet', () => {
  it('mixes mono PCM without altering source audio, silences outputs and flushes the partial chunk before ack', () => {
    const worklet = capture();
    const left = new Float32Array([1, 0.5, 0, -0.5]);
    const right = new Float32Array([-1, 0.5, 1, -0.5]);
    worklet.process([left, right]);
    expect(worklet.output).toEqual([]);
    worklet.message('flush');
    expect(worklet.output.map(item => item.type)).toEqual(['pcm', 'flushed']);
    expect(Array.from(worklet.pcm()[0].pcm)).toEqual([0, 0.5, 0.5, -0.5]);
    expect(worklet.output[1]).toEqual({type: 'flushed', captureId: 7, sampleRate: 48000, totalSamples: 4});
    expect(Array.from(left)).toEqual([1, 0.5, 0, -0.5]);
    worklet.message('flush'); worklet.process([left]);
    expect(worklet.output).toHaveLength(2);
  });

  it('transfers fixed chunks and keeps sample counts contiguous through the final partial flush', () => {
    const worklet = capture(44100);
    worklet.process([new Float32Array(3000).fill(0.25)]);
    expect(worklet.pcm()).toHaveLength(1);
    expect(worklet.pcm()[0].pcm.length).toBe(2048);
    expect(worklet.pcm()[0].totalSamples).toBe(2048);
    worklet.message('flush');
    expect(worklet.pcm().map(item => [item.pcm.length, item.totalSamples, item.sampleRate]))
      .toEqual([[2048, 2048, 44100], [952, 3000, 44100]]);
    expect(worklet.pcm().every(item => Array.from(item.pcm).every(value => value === 0.25))).toBe(true);
  });

  it.each([8000, 48000, 96000])('never emits more than 30 seconds at %d Hz and reports the limit once', rate => {
    const worklet = capture(rate);
    worklet.process([new Float32Array(rate * 30 + 10).fill(0.125)]);
    worklet.process([new Float32Array(128).fill(0.75)]);
    worklet.message('flush');
    expect(worklet.pcm().reduce((total, item) => total + item.pcm.length, 0)).toBe(rate * 30);
    expect(worklet.output.filter(item => item.type === 'limit')).toEqual([{type: 'limit', captureId: 7, totalSamples: rate * 30}]);
    expect(worklet.output.at(-1)).toEqual({type: 'flushed', captureId: 7, sampleRate: rate, totalSamples: rate * 30});
    expect(worklet.pcm().every(item => item.pcm.length <= 2048)).toBe(true);
  });

  it('ignores a stale flush/cancel and discards an active cancellation without final PCM or ack', () => {
    const worklet = capture();
    worklet.process([new Float32Array([0.5])]);
    worklet.message('cancel', 8); worklet.message('flush', 8);
    worklet.process([new Float32Array([0.25])]);
    worklet.message('cancel'); worklet.message('flush');
    worklet.process([new Float32Array([1])]);
    expect(worklet.output).toEqual([]);
  });

  it.each([NaN, Infinity, -Infinity, 1.01, -1.01])('discards non-finite or out-of-range audio (%s) and never flushes it', value => {
    const worklet = capture();
    worklet.process([new Float32Array([0.5, value])]);
    worklet.message('flush');
    expect(worklet.output).toEqual([{type: 'error', captureId: 7, code: 'invalid-pcm'}]);
  });

  it('rejects inconsistent channel sizes and leaves an absent input empty', () => {
    const worklet = capture();
    worklet.process([]);
    expect(worklet.output).toEqual([]);
    worklet.process([new Float32Array([0, 1]), new Float32Array([0])]);
    worklet.message('flush');
    expect(worklet.output).toEqual([{type: 'error', captureId: 7, code: 'invalid-pcm'}]);
  });

  it.each([[7999, 7], [96001, 7], [NaN, 7], [48000, -1], [48000, 1.5]])('rejects invalid capture configuration %s/%s', (rate, id) => {
    const worklet = capture(rate, id);
    worklet.process([new Float32Array([0])]); worklet.message('flush');
    expect(worklet.output).toEqual([{type: 'error', captureId: id, code: 'invalid-config'}]);
  });
});
