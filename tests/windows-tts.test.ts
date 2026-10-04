import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { LocalVoiceService } from '../src/node/voice';
import { startWindowsTts } from '../src/node/windows-tts';

// Windows PowerShell is unavailable on this host. Substitute only the OS process
// boundary; the production service, request bytes and lifecycle stay real.
function processFixture() {
  const events = new EventEmitter();
  const stdin = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough();
  const input: Buffer[] = [];
  stdin.on('data', chunk => input.push(Buffer.from(chunk)));
  const child = Object.assign(events, { stdin, stdout, stderr, pid: 42, kill: vi.fn(() => true) }) as unknown as ChildProcess;
  return { child, stdin, stdout, stderr, events,
    request: () => JSON.parse(Buffer.concat(input).toString('utf8')),
    close: (...args: [unknown?, (number | null)?, (string | null)?]) => {
      const reply = args.length ? args[0] : { ok: true }; const code = args.length > 1 ? args[1] : 0; const signal = args[2] ?? null;
      if (reply !== undefined) stdout.write(JSON.stringify(reply));
      events.emit('close', code, signal);
    } };
}
function harness() {
  const children: ReturnType<typeof processFixture>[] = [];
  const launches: Array<{ command: string; args: readonly string[]; options: SpawnOptions }> = [];
  const launcher = (command: string, args: readonly string[], options: SpawnOptions) => {
    launches.push({ command, args, options });
    const fixture = processFixture(); children.push(fixture); return fixture.child;
  };
  const service = new LocalVoiceService('/missing', { platform: 'win32', arch: 'x64' }, launcher);
  return { service, children, launches };
}
async function tick() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('Windows read aloud process contracts', () => {
  it('starts a Windows read with the managed process boundary', async () => {
    const { service, children } = harness();
    const result = service.speak('你好', '', 1).catch(error => error); await tick();
    expect(children).toHaveLength(1); children[0].close(); expect(await result).toBeUndefined();
  });
  it('carries Unicode and executable-looking text only as UTF-8 stdin data with fixed argv', async () => {
    vi.stubEnv('SystemRoot', 'C:\\Windows');
    const { service, children, launches } = harness();
    const text = '中文🙂\n单双引号\'" \\ ` $() ; & </speak>';
    const first = service.speak(text, '声音\'";$()', 1.25); await tick();
    expect(launches[0].command).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(launches[0].options).toMatchObject({ shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(launches[0].options.windowsVerbatimArguments).not.toBe(true);
    expect(launches[0].args.slice(0, 4)).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand']);
    expect(launches[0].args).toHaveLength(5);
    expect(children[0].request()).toEqual({ operation: 'speak', text: '中文🙂\n单双引号\'" \\  $() ; & </speak>', voice: '声音\'";$()', rate: 3 });
    children[0].close(); await first;
    const second = service.speak('另一段文字', '', 0.75); await tick();
    expect(launches[1]).toEqual(launches[0]);
    expect(children[1].request()).toEqual({ operation: 'speak', text: '另一段文字', voice: '', rate: -4 });
    children[1].close(); await second;
  });

  it('stays pending until close even after a successful reply or exit event', async () => {
    const { service, children } = harness(); let settled = false;
    const pending = service.speak('你好', '', 1).then(() => { settled = true; }); await tick();
    children[0].stdout.write('{"ok":true}'); children[0].events.emit('exit', 0, null); await tick();
    expect(settled).toBe(false);
    children[0].close(undefined); await pending; expect(settled).toBe(true);
  });

  it('treats Windows code 1 without a signal as cancellation and waits for close', async () => {
    const { service, children } = harness(); let settled = false;
    const pending = service.speak('你好', '', 1).then(() => { settled = true; }); await tick();
    service.stopSpeaking(); children[0].stdin.emit('error', new Error('EPIPE private text')); await tick();
    expect(settled).toBe(false); expect(children[0].child.kill).toHaveBeenCalled();
    children[0].close(undefined, 1, null); await pending;
  });

  it('starts only the newest replacement after the old process closes', async () => {
    const { service, children } = harness();
    const a = service.speak('A', '', 1); await tick();
    const b = service.speak('B', '', 1); const c = service.speak('C', '', 1); await tick();
    expect(children).toHaveLength(1);
    children[0].close(undefined, 1); await a; await b; await tick();
    expect(children).toHaveLength(2); expect(children[1].request().text).toBe('C');
    children[0].events.emit('error', new Error('late old error'));
    service.stopSpeaking(); expect(children[1].child.kill).toHaveBeenCalled();
    children[1].close(undefined, 1); await c;
  });

  it('blocks replacements when termination cannot be confirmed and retains the old job until close', async () => {
    vi.useFakeTimers(); const { service, children } = harness();
    const a = service.speak('A', '', 1); const aResult = a.catch(error => error.message); await tick();
    children[0].child.kill = vi.fn(() => false);
    const b = service.speak('B', '', 1); const bResult = b.catch(error => error.message); await tick();
    await vi.advanceTimersByTimeAsync(2001);
    expect(await aResult).toContain('未能停止'); expect(await bResult).toContain('未能停止');
    const cResult = service.speak('C', '', 1).catch(error => error.message); await tick();
    await vi.advanceTimersByTimeAsync(2001); expect(await cResult).toContain('未能停止'); expect(children).toHaveLength(1);
    children[0].close(undefined, 1);
    const d = service.speak('D', '', 1); await tick(); expect(children).toHaveLength(2);
    children[1].close(); await d;
  });

  it('does not time out normal long readings after ten seconds', async () => {
    vi.useFakeTimers(); const { service, children } = harness();
    const pending = service.speak('长消息', '', 1); await tick();
    await vi.advanceTimersByTimeAsync(30000); expect(children[0].child.kill).not.toHaveBeenCalled();
    children[0].close(); await pending;
  });

  it.each([[0.1, -10], [0.5, -10], [0.75, -4], [1, 0], [1.25, 3], [1.5, 6], [2, 10], [50, 10], [NaN, 0], [Infinity, 0]])('normalizes relative rate %s to %s', async (rate, expected) => {
    const { service, children } = harness(); const pending = service.speak('你好', '', rate); await tick();
    expect(children[0].request().rate).toBe(expected); children[0].close(); await pending;
  });

  it('rejects empty or excessive text before launching and preserves Markdown cleaning', async () => {
    const { service, children } = harness();
    await expect(service.speak('', '', 1)).rejects.toThrow('没有可朗读');
    await expect(service.speak('a'.repeat(100001), '', 1)).rejects.toThrow('过长'); expect(children).toHaveLength(0);
    const pending = service.speak('你好\n```js\nprivateCode()\n```\n看[说明](https://example.com)', '', 1); await tick();
    expect(children[0].request().text).toBe('你好\n代码段已略过。\n看说明'); children[0].close(); await pending;
  });

  it.each(['spawn', 'stdin', 'exit'])('returns a controlled %s error without private details', async kind => {
    const { service, children } = harness(); const result = service.speak('PRIVATE', '', 1).catch(error => error.message); await tick();
    if (kind === 'spawn') { Object.assign(children[0].child, { pid: undefined }); children[0].events.emit('error', new Error('PRIVATE C:\\Users\\alice\\Secret')); }
    if (kind === 'stdin') { children[0].stdin.emit('error', new Error('PRIVATE')); children[0].close(undefined, 1); }
    if (kind === 'exit') children[0].close({ ok: true }, 1);
    expect(await result).toContain('朗读'); expect(await result).not.toMatch(/PRIVATE|Users|Secret/);
    children[0].close(undefined, 1); children[0].events.emit('error', new Error('late error'));
  });

  it('waits for close when a process error happens after spawn', async () => {
    const { service, children } = harness(); let settled = false;
    const result = service.speak('PRIVATE', '', 1).catch(error => { settled = true; return error.message; }); await tick();
    children[0].events.emit('error', new Error('PRIVATE')); await tick();
    expect(children[0].child.kill).toHaveBeenCalled(); expect(settled).toBe(false);
    children[0].close(undefined, 1); expect(await result).toContain('无法启动');
  });

  it('cancels a replacement while it awaits close without starting obsolete work', async () => {
    const { service, children } = harness(); const a = service.speak('A', '', 1); await tick();
    const b = service.speak('B', '', 1); service.cancelAll(); children[0].close(undefined, 1);
    await a; await b; expect(children).toHaveLength(1);
  });

  it.each([
    null, { ok: 'true' }, { ok: true, voices: [] }, { ok: false, error: 'private details' },
  ])('rejects a malformed speak reply %j', async reply => {
    const { service, children } = harness(); const result = service.speak('你好', '', 1).catch(error => error.message); await tick();
    children[0].close(reply); expect(await result).toContain('朗读');
  });

  it.each(['stdout', 'stderr'])('bounds %s bytes and waits for termination', async stream => {
    const { service, children } = harness(); let settled = false;
    const result = service.speak('你好', '', 1).catch(error => { settled = true; return error.message; }); await tick();
    children[0][stream as 'stdout' | 'stderr'].write(Buffer.alloc(stream === 'stdout' ? 1024 * 1024 + 1 : 64 * 1024 + 1)); await tick();
    expect(children[0].child.kill).toHaveBeenCalled(); expect(settled).toBe(false);
    children[0].close(undefined, 1); expect(await result).toContain('朗读');
  });

  it('rejects invalid UTF-8 even when replacement decoding could form valid JSON', async () => {
    const { service, children } = harness(); const result = service.listVoices().catch(error => error.message); await tick();
    children[0].stdout.write(Buffer.concat([Buffer.from('{"ok":true,"voices":[{"name":"'), Buffer.from([0xff]), Buffer.from('","language":"zh-CN"}]}')]));
    children[0].close(undefined); expect(await result).toContain('朗读');
  });

  it('rejects malformed OS paths without falling back to PATH or echoing directories', async () => {
    vi.stubEnv('SystemRoot', 'relative\\PRIVATE'); const { service, launches } = harness();
    const result = await service.speak('PRIVATE', '', 1).catch(error => error.message);
    expect(result).toContain('无法启动'); expect(result).not.toContain('PRIVATE'); expect(launches).toHaveLength(0);
  });
});

describe('Windows helper boundary with actual Node child semantics', () => {
  it('passes literal backticks and Unicode through stdin and completes after a real child closes', async () => {
    const text = '中文🙂\n\'" \\ ` $() ; & </speak>';
    const childScript = `let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => { const data = JSON.parse(input); if (data.text !== ${JSON.stringify(text)}) process.exit(2); process.stdout.write('{"ok":true}'); });`;
    const job = startWindowsTts({ operation: 'speak', text, voice: '', rate: 0 }, () => spawn(process.execPath, ['-e', childScript], { stdio: ['pipe', 'pipe', 'pipe'] }));
    expect(await job.completion).toEqual({ ok: true }); expect(job.exited).toBe(true); await job.closed;
  });

  it('safely reports a real failed spawn without a leaked process or unhandled stdin error', async () => {
    const job = startWindowsTts({ operation: 'speak', text: 'PRIVATE', voice: '', rate: 0 }, () => spawn('/missing/windows-tts-executable', [], { stdio: ['pipe', 'pipe', 'pipe'] }));
    await expect(job.completion).rejects.toThrow('朗读'); await job.closed; expect(job.exited).toBe(true);
  });
});

describe('Windows voice queries', () => {
  it('queries afresh after successful, empty and failed results and shares simultaneous queries', async () => {
    const { service, children } = harness(); const one = service.listVoices(); const concurrent = service.listVoices(); await tick();
    expect(children).toHaveLength(1); expect(children[0].request()).toEqual({ operation: 'voices' });
    children[0].close({ ok: true, voices: [{ name: '微软中文🙂', language: 'zh-CN' }] });
    expect(await one).toEqual([{ name: '微软中文🙂', language: 'zh-CN' }]); expect(await concurrent).toEqual(await one);
    const empty = service.listVoices(); await tick(); children[1].close({ ok: true, voices: [] }); expect(await empty).toEqual([]);
    const failure = service.listVoices().catch(error => error.message); await tick(); children[2].close({ ok: false, error: 'engine-unavailable' }); expect(await failure).toContain('朗读');
    const retry = service.listVoices(); await tick(); children[3].close({ ok: true, voices: [{ name: 'English', language: 'en-US' }] }); expect(await retry).toHaveLength(1);
  });

  it('times out queries at ten seconds, waits for close and allows retry', async () => {
    vi.useFakeTimers(); const { service, children } = harness(); let settled = false;
    const result = service.listVoices().catch(error => { settled = true; return error.message; }); await tick();
    await vi.advanceTimersByTimeAsync(10000); expect(children[0].child.kill).toHaveBeenCalled(); expect(settled).toBe(false);
    children[0].close(undefined, 1); expect(await result).toContain('超时');
    const retry = service.listVoices(); await tick(); children[1].close({ ok: true, voices: [] }); await retry;
  });

  it('retains an unclosed timed-out query to prevent accumulating child processes', async () => {
    vi.useFakeTimers(); const { service, children } = harness(); const result = service.listVoices().catch(error => error.message); await tick();
    await vi.advanceTimersByTimeAsync(12001); expect(await result).toContain('未能停止');
    await expect(service.listVoices()).rejects.toThrow('未能停止'); expect(children).toHaveLength(1);
    children[0].close(undefined, 1); await tick();
    const retry = service.listVoices(); await tick(); children[1].close({ ok: true, voices: [] }); await retry;
  });

  it.each([{ ok: true }, { ok: true, voices: {} }, { ok: true, voices: [{ name: '', language: 'zh-CN' }] }, { ok: true, voices: [{ name: 'Voice', language: 123 }] }])('rejects malformed voice metadata %j', async reply => {
    const { service, children } = harness(); const result = service.listVoices().catch(error => error.message); await tick(); children[0].close(reply);
    expect(await result).toContain('朗读');
  });

  it('shows a stable missing-voices action and keeps unsupported platforms controlled', async () => {
    const { service, children } = harness(); const result = service.speak('你好', 'Tingting', 1).catch(error => error.message); await tick(); children[0].close({ ok: false, error: 'no-voices' });
    expect(await result).toContain('安装语音包');
    const unsupported = new LocalVoiceService('/missing', { platform: 'linux', arch: 'x64' });
    expect(await unsupported.listVoices()).toEqual([]); await expect(unsupported.speak('你好', '', 1)).rejects.toThrow('不支持');
  });
});
