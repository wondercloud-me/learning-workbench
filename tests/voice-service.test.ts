import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalVoiceService } from '../src/node/voice';
import { encodeWav } from '../src/core/speech';
const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });

describe.skipIf(process.platform !== 'darwin' || process.arch !== 'arm64')('local voice process', () => {
  it('explains a missing model without attempting recognition', async () => {
    const service = new LocalVoiceService('/missing-voice-resources');
    expect((await service.status()).ready).toBe(false);
    await expect(service.transcribe('test', encodeWav(new Float32Array([0.5])))).rejects.toThrow('缺少语音模型');
  });
  it('cancels pending work and prevents simultaneous recognition jobs', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'voice-test-')); folders.push(root);
    await mkdir(root, { recursive: true });
    await Promise.all(['sherpa-onnx-offline', 'model.int8.onnx', 'tokens.txt'].map(file => writeFile(path.join(root, file), '')));
    const service = new LocalVoiceService(root);
    const pending = service.transcribe('first', encodeWav(new Float32Array([0.5])));
    await expect(service.transcribe('second', encodeWav(new Float32Array([0.5])))).rejects.toThrow('已有一段录音');
    service.cancel('first');
    await expect(pending).rejects.toThrow('已取消');
  });
  it.skipIf(process.env.VOICE_INTEGRATION !== '1')('recognizes the bundled Chinese sample without a network or API key', async () => {
    const service = new LocalVoiceService(path.resolve('resources/speech'));
    const buffer = await readFile('.cache/speech/zh.wav');
    const text = await service.transcribe('real-local-sample', buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
    expect(text).toContain('早上9点');
    expect(text).toContain('下午5点');
  });
});
