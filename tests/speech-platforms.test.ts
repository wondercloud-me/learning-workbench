import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalVoiceService } from '../src/node/voice';
// @ts-expect-error Build helper is plain JavaScript and is bundled by esbuild.
import { selectSpeechTarget, parseSpeechArgs } from '../scripts/speech-platforms.mjs';

// Test the executable JS build helper directly, including command-line behavior.
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true })));
});

describe('speech target selection', () => {
  it.each([
    ['darwin', 'arm64', 'mac-arm64', 'sherpa-onnx-offline', 'osx-arm64-static-no-tts'],
    ['darwin', 'x64', 'mac-x64', 'sherpa-onnx-offline', 'osx-x64-static-no-tts'],
    ['win32', 'x64', 'win-x64', 'sherpa-onnx-offline.exe', 'win-x64-static-MT-Release-no-tts'],
  ])('selects only the official %s/%s engine', (platform, arch, folder, executable, asset) => {
    const target = selectSpeechTarget(platform, arch);
    expect(target.folder).toBe(folder);
    expect(target.executable).toBe(executable);
    expect(target.archive).toBe(`sherpa-onnx-v1.13.8-${asset}.tar.bz2`);
    expect(target.url).toBe(`https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-${asset}.tar.bz2`);
    expect(target.archiveHash).toMatch(/^[a-f0-9]{64}$/);
    expect(target.executableHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([['linux', 'x64'], ['win32', 'arm64'], ['darwin', 'ia32'], ['../win32', 'x64']])('rejects unsupported %s/%s before choosing an archive', (platform, arch) => {
    expect(() => selectSpeechTarget(platform, arch)).toThrow('不支持');
  });
});

describe('speech command arguments', () => {
  it('uses the host only when no target is provided', () => {
    expect(parseSpeechArgs([], { platform: 'darwin', arch: 'arm64' })).toEqual({ platform: 'darwin', arch: 'arm64' });
  });
  it('allows an explicit Windows target on a Mac host', () => {
    expect(parseSpeechArgs(['--', '--platform', 'win32', '--arch=x64'], { platform: 'darwin', arch: 'arm64' })).toEqual({ platform: 'win32', arch: 'x64' });
  });
  it.each([
    ['--platform'], ['--arch', '--platform', 'win32'], ['--arch='], ['--target', 'win32'],
    ['--arch', 'x64', '--arch', 'arm64'], ['--platform', 'win32', '--platform=darwin'],
    ['win32'], ['--', '--'],
  ])('rejects malformed or ambiguous arguments %j', (...args) => {
    expect(() => parseSpeechArgs(args, { platform: 'darwin', arch: 'arm64' })).toThrow();
  });
});

describe('voice resources by runtime target', () => {
  async function resourceRoot(folder: string, executable: string, manifestTarget?: { platform: string; arch: string }) {
    const root = await mkdtemp(path.join(tmpdir(), 'voice-platform-')); folders.push(root);
    const directory = path.join(root, folder);
    await mkdir(directory, { recursive: true });
    await Promise.all([executable, 'model.int8.onnx', 'tokens.txt'].map(file => writeFile(path.join(directory, file), 'test fixture')));
    if (manifestTarget) await writeFile(path.join(directory, 'speech-manifest.json'), JSON.stringify({ ...manifestTarget, version: '1.13.8' }));
    return root;
  }

  it.each([
    ['darwin', 'arm64', 'mac-arm64', 'sherpa-onnx-offline'],
    ['darwin', 'x64', 'mac-x64', 'sherpa-onnx-offline'],
    ['win32', 'x64', 'win-x64', 'sherpa-onnx-offline.exe'],
  ])('finds prepared %s/%s resources', async (platform, arch, folder, executable) => {
    const root = await resourceRoot(folder, executable, { platform, arch });
    // A target is injected to check the runtime branch on any CI host.
    const service = new LocalVoiceService(root, { platform, arch });
    expect((await service.status()).ready).toBe(true);
  });

  it('rejects a Mac binary in a Windows packaged resources directory', async () => {
    const root = await resourceRoot('', 'sherpa-onnx-offline', { platform: 'darwin', arch: 'arm64' });
    expect((await new LocalVoiceService(root, { platform: 'win32', arch: 'x64' }).status()).ready).toBe(false);
  });

  it('rejects a wrong-target manifest even when an exe filename exists', async () => {
    const root = await resourceRoot('', 'sherpa-onnx-offline.exe', { platform: 'darwin', arch: 'arm64' });
    expect((await new LocalVoiceService(root, { platform: 'win32', arch: 'x64' }).status()).ready).toBe(false);
  });

  it.each(['null', '0', '[]', '"invalid"'])('rejects malformed packaged manifest %s', async contents => {
    const root = await resourceRoot('', 'sherpa-onnx-offline.exe');
    await writeFile(path.join(root, 'speech-manifest.json'), contents);
    expect((await new LocalVoiceService(root, { platform: 'win32', arch: 'x64' }).status()).ready).toBe(false);
  });

  it('accepts manifest-matched flat Windows packaged resources', async () => {
    const root = await resourceRoot('', 'sherpa-onnx-offline.exe', { platform: 'win32', arch: 'x64' });
    expect((await new LocalVoiceService(root, { platform: 'win32', arch: 'x64' }).status()).ready).toBe(true);
  });

  it('keeps the existing flat Mac arm64 resources usable', async () => {
    const root = await resourceRoot('', 'sherpa-onnx-offline');
    expect((await new LocalVoiceService(root, { platform: 'darwin', arch: 'arm64' }).status()).ready).toBe(true);
  });

  it('describes an unsupported runtime without attempting an executable', async () => {
    const service = new LocalVoiceService('/missing', { platform: 'linux', arch: 'x64' });
    expect(await service.status()).toMatchObject({ ready: false, reason: expect.stringContaining('不支持') });
  });

  it('routes Windows speech synthesis to the helper and reports startup failure clearly', async () => {
    let launches = 0;
    const service = new LocalVoiceService('/missing', { platform: 'win32', arch: 'x64' }, () => { launches++; throw new Error('OS launch failure'); });
    await expect(service.listVoices()).rejects.toThrow('系统朗读无法启动');
    await expect(service.speak('hello', '', 1)).rejects.toThrow('系统朗读无法启动');
    expect(launches).toBe(2);
  });
});
