import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import path from 'node:path';
import type { SystemVoice } from './voice';

type WindowsTtsRequest = { operation: 'voices' } | { operation: 'speak'; text: string; voice: string; rate: number };
type WindowsTtsReply = { ok: true; voices: SystemVoice[] } | { ok: true } | { ok: false; error: 'engine-unavailable' | 'no-voices' | 'speech-failed' };
export type WindowsTtsLauncher = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
export interface WindowsTtsJob {
  child: ChildProcess;
  completion: Promise<WindowsTtsReply>;
  closed: Promise<void>;
  readonly exited: boolean;
  cancel(): void;
}

// This is executable code. Learning text and settings only enter through UTF-8
// JSON on stdin; never interpolate them into this script or its command line.
const script = String.raw`
$ErrorActionPreference = 'Stop'
$synth = $null
$reader = $null
$writer = $null
$failure = 'engine-unavailable'
try {
  $utf8 = New-Object System.Text.UTF8Encoding($false, $true)
  $reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8)
  $request = ConvertFrom-Json -InputObject $reader.ReadToEnd()
  Add-Type -AssemblyName System.Speech
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $enabled = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo })
  $failure = 'speech-failed'
  if ($request.operation -ceq 'voices') {
    $voices = @($enabled | ForEach-Object { @{ name = $_.Name; language = $_.Culture.Name } })
    $reply = @{ ok = $true; voices = $voices }
  } elseif ($request.operation -ceq 'speak') {
    if ($enabled.Count -eq 0) {
      $reply = @{ ok = $false; error = 'no-voices' }
    } else {
      $selected = $enabled | Where-Object { $_.Name -ceq [string]$request.voice } | Select-Object -First 1
      if ($null -eq $selected) { $selected = $enabled | Where-Object { $_.Culture.Name -ieq 'zh-CN' } | Select-Object -First 1 }
      if ($null -eq $selected) { $selected = $enabled | Where-Object { $_.Culture.Name.StartsWith('zh', [StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1 }
      if ($null -eq $selected) { $selected = $enabled | Where-Object { $_.Name -ceq $synth.Voice.Name } | Select-Object -First 1 }
      if ($null -eq $selected) { $selected = $enabled[0] }
      $synth.SelectVoice($selected.Name)
      $synth.Rate = [int]$request.rate
      $synth.SetOutputToDefaultAudioDevice()
      $synth.Speak([string]$request.text)
      $reply = @{ ok = $true }
    }
  } else { $reply = @{ ok = $false; error = 'speech-failed' } }
} catch { $reply = @{ ok = $false; error = $failure } }
finally {
  if ($null -ne $synth) { $synth.Dispose() }
  if ($null -ne $reader) { $reader.Dispose() }
}
try {
  $writer = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), (New-Object System.Text.UTF8Encoding($false)))
  $writer.Write((ConvertTo-Json -InputObject $reply -Compress -Depth 4))
  $writer.Flush()
} finally { if ($null -ne $writer) { $writer.Dispose() } }
`;
const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
const options: SpawnOptions = { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] };
const failed = () => new Error('系统朗读失败，请在设置中换一个声音后重试');
const stopFailed = () => new Error('系统朗读未能停止，请关闭应用后重试');

function powerShellPath() {
  // SystemRoot is inherited from the main process's OS environment, never IPC.
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  if (!/^[a-z]:\\/i.test(root) || !path.win32.isAbsolute(root)) throw new Error('系统朗读无法启动');
  return path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

export function windowsSpeechRate(rate: number) {
  const relative = Math.max(0.5, Math.min(2, Number.isFinite(rate) ? rate : 1));
  return Math.max(-10, Math.min(10, Math.round(10 * Math.log2(relative))));
}

function parseReply(bytes: Buffer, operation: WindowsTtsRequest['operation']): WindowsTtsReply {
  let reply: any;
  try { reply = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw failed(); }
  if (!reply || typeof reply !== 'object' || Array.isArray(reply)) throw failed();
  if (reply.ok === false && Object.keys(reply).length === 2 && ['engine-unavailable', 'no-voices', 'speech-failed'].includes(reply.error)) return reply;
  if (reply.ok !== true) throw failed();
  if (operation === 'speak') {
    if (Object.keys(reply).length !== 1) throw failed();
  } else {
    if (Object.keys(reply).length !== 2 || !Array.isArray(reply.voices) || reply.voices.length > 4096) throw failed();
    for (const voice of reply.voices) {
      if (!voice || typeof voice !== 'object' || Array.isArray(voice) || Object.keys(voice).length !== 2 || typeof voice.name !== 'string' || !voice.name.trim() || voice.name.length > 1024 || typeof voice.language !== 'string' || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(voice.language)) throw failed();
    }
  }
  return reply;
}

export function windowsTtsError(reply: WindowsTtsReply): Error | null {
  if (reply.ok) return null;
  if (reply.error === 'no-voices') return new Error('没有可用的系统朗读声音，请在 Windows 设置中安装语音包后重试');
  if (reply.error === 'engine-unavailable') return new Error('系统朗读引擎无法启动，请检查 Windows 系统语音组件后重试');
  return failed();
}

export function startWindowsTts(request: WindowsTtsRequest, launcher: WindowsTtsLauncher = spawn): WindowsTtsJob {
  let child: ChildProcess;
  try { child = launcher(powerShellPath(), [...args], { ...options }); }
  catch { throw new Error('系统朗读无法启动'); }
  let exited = false; let settled = false; let cancelled = false; let failure: Error | null = null;
  let stdoutSize = 0; let stderrSize = 0; let output: Buffer[] = [];
  let queryTimer: ReturnType<typeof setTimeout> | undefined;
  let terminationTimer: ReturnType<typeof setTimeout> | undefined;
  let resolve!: (reply: WindowsTtsReply) => void; let reject!: (error: Error) => void; let resolveClosed!: () => void;
  const completion = new Promise<WindowsTtsReply>((yes, no) => { resolve = yes; reject = no; });
  const closed = new Promise<void>(yes => { resolveClosed = yes; });
  const settle = (reply?: WindowsTtsReply, error?: Error) => {
    if (settled) return;
    settled = true;
    if (error) reject(error); else resolve(reply!);
  };
  const terminate = () => {
    if (exited) return;
    // killed only reports a signal attempt. Keep the job until close, even when
    // kill returns false, throws, or Windows reports code 1 with no signal.
    if (!terminationTimer) terminationTimer = setTimeout(() => settle(undefined, stopFailed()), 2000);
    try { child.kill(); } catch { /* The close deadline reports uncertain termination. */ }
  };
  const fail = (error: Error) => {
    if (exited || failure) return;
    failure = error; terminate();
  };
  const onStdout = (chunk: Buffer | string) => {
    if (exited || failure) return;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    stdoutSize += bytes.length;
    if (stdoutSize > 1024 * 1024) { output = []; fail(failed()); } else output.push(bytes);
  };
  const onStderr = (chunk: Buffer | string) => {
    if (exited || failure) return;
    stderrSize += Buffer.byteLength(chunk);
    if (stderrSize > 64 * 1024) fail(failed());
  };
  const finish = (code: number | null) => {
    if (exited) return;
    exited = true;
    clearTimeout(queryTimer); clearTimeout(terminationTimer);
    child.stdout?.off('data', onStdout); child.stderr?.off('data', onStderr);
    resolveClosed();
    try {
      if (cancelled) settle({ ok: true });
      else if (failure || code !== 0) settle(undefined, failure || failed());
      else settle(parseReply(Buffer.concat(output), request.operation));
    } catch { settle(undefined, failed()); }
    output = [];
  };
  child.stdout?.on('data', onStdout); child.stderr?.on('data', onStderr);
  // Guard late errors as well: after cancellation they belong to this job,
  // and must never reject another reading or become an unhandled EPIPE.
  child.stdin?.on('error', () => fail(failed()));
  child.on('error', () => {
    if (exited) return;
    if (child.pid === undefined) { failure = new Error('系统朗读无法启动'); finish(null); }
    else fail(new Error('系统朗读无法启动'));
  });
  child.once('close', finish);
  if (request.operation === 'voices') queryTimer = setTimeout(() => fail(new Error('系统朗读声音查询超时，请重试')), 10000);
  try {
    if (!child.stdin) fail(new Error('系统朗读无法启动'));
    else child.stdin.end(Buffer.from(JSON.stringify(request), 'utf8'));
  } catch { fail(failed()); }
  return { child, completion, closed, get exited() { return exited; }, cancel() { if (exited) return; cancelled = true; terminate(); } };
}

export async function waitForWindowsTtsClose(job: WindowsTtsJob) {
  if (job.exited) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([job.closed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(stopFailed()), 2000); })]);
  } finally { clearTimeout(timer); }
}
