import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseTranscript, speechChunks, validateWav } from '../core/speech';
import { startWindowsTts, waitForWindowsTtsClose, windowsSpeechRate, windowsTtsError, type WindowsTtsJob, type WindowsTtsLauncher } from './windows-tts';
// @ts-expect-error Shared plain JavaScript helper is bundled into the Electron main process.
import { selectSpeechTarget } from '../../scripts/speech-platforms.mjs';

const execute = promisify(execFile);
export interface SystemVoice { name: string; language: string }

export class LocalVoiceService {
  private jobs = new Map<string, AbortController>();
  private reader: ChildProcess | null = null;
  private generation = 0;
  private voices: SystemVoice[] | null = null;
  private windowsReader: WindowsTtsJob | null = null;
  private windowsQuery: WindowsTtsJob | null = null;
  constructor(private readonly root: string, private readonly target: { platform: string; arch: string } = { platform: process.platform, arch: process.arch }, private readonly windowsLauncher?: WindowsTtsLauncher) {}

  private async resources(): Promise<{ directory: string; executable: string } | null> {
    let spec;
    try { spec = selectSpeechTarget(this.target.platform, this.target.arch); } catch { return null; }
    for (const directory of [path.join(this.root, spec.folder), this.root]) {
      try {
        let manifest;
        let legacy = false;
        try { manifest = JSON.parse(await readFile(path.join(directory, 'speech-manifest.json'), 'utf8')); }
        catch (error) {
          // Only the existing unscoped Apple Silicon resource layout predates manifests.
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || directory !== this.root || this.target.platform !== 'darwin' || this.target.arch !== 'arm64') continue;
          legacy = true;
        }
        if (!legacy && (!manifest || typeof manifest !== 'object' || manifest.platform !== this.target.platform || manifest.arch !== this.target.arch || manifest.version !== spec.version)) continue;
        await Promise.all([spec.executable, 'model.int8.onnx', 'tokens.txt'].map(name => access(path.join(directory, name))));
        return { directory, executable: spec.executable };
      } catch { /* A missing or wrong-target resource directory is not ready. */ }
    }
    return null;
  }

  async status() {
    let supported = true;
    try { selectSpeechTarget(this.target.platform, this.target.arch); } catch { supported = false; }
    const ready = supported && !!await this.resources();
    return { ready, model: 'SenseVoice Small · 本机识别', reason: ready ? '' : supported ? '缺少语音模型或引擎与系统不匹配，请重新安装完整应用' : '当前平台不支持本机语音识别（支持 Mac arm64 / x64 和 Windows x64）' };
  }

  async transcribe(id: string, wav: ArrayBuffer): Promise<string> {
    validateWav(wav);
    if (!id || id.length > 100) throw new Error('录音标识不正确');
    if (this.jobs.size) throw new Error('已有一段录音正在识别，请稍候');
    const controller = new AbortController();
    this.jobs.set(id, controller);
    let directory = '';
    try {
      const status = await this.status();
      if (!status.ready) throw new Error(status.reason);
      const resources = await this.resources();
      if (!resources) throw new Error('缺少语音模型，请重新安装完整应用');
      controller.signal.throwIfAborted();
      directory = await mkdtemp(path.join(tmpdir(), 'growth-voice-'));
      const file = path.join(directory, 'recording.wav');
      await writeFile(file, Buffer.from(wav), { mode: 0o600 });
      controller.signal.throwIfAborted();
      const result = await execute(path.join(resources.directory, resources.executable), [
        `--sense-voice-model=${path.join(resources.directory, 'model.int8.onnx')}`,
        `--tokens=${path.join(resources.directory, 'tokens.txt')}`,
        '--sense-voice-language=auto', '--sense-voice-use-itn=1', '--num-threads=2', file
      ], { signal: controller.signal, timeout: 90000, maxBuffer: 1024 * 1024 });
      controller.signal.throwIfAborted();
      return parseTranscript(result.stdout);
    } catch (error) {
      if (controller.signal.aborted) throw new Error('已取消语音识别');
      const failure = error as NodeJS.ErrnoException & { killed?: boolean };
      if (failure.killed) throw new Error('语音识别超时，请分成更短的句子重试');
      if (failure.code) throw new Error('本机语音引擎未能运行，请重新安装完整应用');
      throw error;
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
      this.jobs.delete(id);
    }
  }

  cancel(id: string) { this.jobs.get(id)?.abort(); }
  stopSpeaking() { this.generation++; this.windowsReader?.cancel(); this.reader?.kill(); this.reader = null; }
  cancelAll() { this.jobs.forEach(controller => controller.abort()); this.stopSpeaking(); }

  async listVoices(): Promise<SystemVoice[]> {
    if (this.target.platform === 'win32') {
      const job = this.windowsQuery || startWindowsTts({ operation: 'voices' }, this.windowsLauncher);
      this.windowsQuery = job;
      void job.closed.then(() => { if (this.windowsQuery === job) this.windowsQuery = null; });
      const reply = await job.completion;
      const error = windowsTtsError(reply); if (error) throw error;
      return 'voices' in reply ? reply.voices : [];
    }
    if (this.voices) return this.voices;
    if (this.target.platform !== 'darwin') return [];
    const { stdout } = await execute('/usr/bin/say', ['-v', '?'], { timeout: 10000 });
    this.voices = stdout.split('\n').flatMap(line => {
      const match = line.match(/^(.+?)\s+([a-z]{2,3}_[A-Z]{2})\s+#/);
      return match ? [{ name: match[1].trim(), language: match[2] }] : [];
    });
    return this.voices;
  }

  async speak(text: string, requestedVoice: string, rate: number): Promise<void> {
    if (this.target.platform !== 'darwin' && this.target.platform !== 'win32') throw new Error('当前系统不支持本机朗读');
    if (typeof text !== 'string' || text.length > 100000) throw new Error('朗读文本过长');
    const clean = speechChunks(text).join('');
    if (!clean.trim()) throw new Error('这条消息没有可朗读的文字');
    this.stopSpeaking();
    const generation = this.generation;
    if (this.target.platform === 'win32') {
      const previous = this.windowsReader;
      if (previous) await waitForWindowsTtsClose(previous);
      if (generation !== this.generation) return;
      const job = startWindowsTts({ operation: 'speak', text: clean, voice: typeof requestedVoice === 'string' ? requestedVoice : '', rate: windowsSpeechRate(rate) }, this.windowsLauncher);
      this.windowsReader = job;
      void job.closed.then(() => { if (this.windowsReader === job) this.windowsReader = null; });
      const reply = await job.completion;
      const error = windowsTtsError(reply); if (error) throw error;
      return;
    }
    const voices = await this.listVoices();
    if (generation !== this.generation) return;
    const voice = voices.find(item => item.name === requestedVoice) || voices.find(item => item.name === 'Tingting') || voices.find(item => item.language === 'zh_CN');
    const args = ['-r', String(Math.round(180 * Math.max(0.5, Math.min(2, Number.isFinite(rate) ? rate : 1))))];
    if (voice) args.push('-v', voice.name);
    await new Promise<void>((resolve, reject) => {
      const child = spawn('/usr/bin/say', args, { stdio: ['pipe', 'ignore', 'pipe'] });
      this.reader = child;
      child.stdin?.on('error', () => {});
      child.stdin?.end(clean);
      child.on('error', () => { if (this.reader === child) this.reader = null; reject(new Error('系统朗读无法启动')); });
      child.on('close', (code, signal) => { if (this.reader === child) this.reader = null; code === 0 || signal ? resolve() : reject(new Error('系统朗读失败，请在设置中换一个声音')); });
    });
  }
}
