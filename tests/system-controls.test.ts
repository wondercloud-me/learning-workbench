import {EventEmitter} from 'node:events';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {LoginControls, NotificationControls} from '../src/node/system-controls';

const missing = () => Object.assign(new Error('private path'), {code: 'ENOENT'});
const deferred = <T,>() => {let resolve!: (value: T) => void; const promise = new Promise<T>(r => {resolve = r;}); return {promise, resolve};};
const tick = () => new Promise<void>(resolve => queueMicrotask(resolve));
afterEach(() => vi.useRealTimers());

function loginHarness({platform = 'darwin', packaged = true, raw = '{"enabled":false}', readError = null as Error | null} = {}) {
  let text = raw;
  const writes: string[] = [], sets: unknown[] = [], queries: unknown[] = [];
  const native = {openAtLogin: false, status: 'not-registered' as string, wasOpenedAtLogin: false, executableWillLaunchAtLogin: false, launchItems: [] as Array<{name: string; path: string; args: string[]; scope: 'user' | 'machine'; enabled: boolean}>};
  const storage = {read: async () => {if (readError) throw readError; return text;}, write: async (value: string) => {text = value; writes.push(value);}};
  const api = {get: (options: unknown) => {queries.push(options); return {...native};}, set: (options: {openAtLogin: boolean}) => {sets.push(options); native.openAtLogin = options.openAtLogin;}};
  const control = new LoginControls({platform, isPackaged: packaged, execPath: 'C:\\Users\\User\\Workbench\\学习工作台.exe', storage, api});
  return {control, storage, api, native, writes, sets, queries, text: () => text};
}

describe('login intent and operating system report', () => {
  it.each([undefined, 'null', '{"enabled":null}'])('initializes authorized default once for genuinely absent or null preference: %s', async raw => {
    const h = loginHarness({raw, readError: raw === undefined ? missing() : null});
    expect((await h.control.initialize()).requestedPreference).toBe(true);
    expect(h.writes).toHaveLength(1); expect(h.sets).toEqual([{openAtLogin: true}]);
    await h.control.status(); await h.control.initialize();
    expect(h.writes).toHaveLength(1); expect(h.sets).toHaveLength(1);
  });
  it.each(['{"enabled":false}', '{"enabled":true}'])('ordinary startup and refresh preserve saved and OS choices: %s', async raw => {
    const h = loginHarness({raw}); await h.control.initialize(); await h.control.status();
    expect(h.writes).toHaveLength(0); expect(h.sets).toHaveLength(0);
    expect((await h.control.status()).openAtLogin).toBe(false);
  });
  it.each(['broken', '{}', '{"enabled":"false"}'])('reports corrupt preference without initializing it: %s', async raw => {
    const h = loginHarness({raw}); const status = await h.control.initialize();
    expect(status.requestedPreference).toBeNull(); expect(status.errors[0].code).toBe('login-read');
    expect(h.writes).toHaveLength(0); expect(h.sets).toHaveLength(0);
  });
  it('does not register on read failure, developer launch or unsupported platform', async () => {
    for (const options of [{readError: new Error('PRIVATE')}, {packaged: false, readError: missing()}, {platform: 'linux', readError: missing()}]) {
      const h = loginHarness(options); const status = await h.control.initialize();
      expect(h.writes).toHaveLength(0); expect(h.sets).toHaveLength(0);
      if (options.packaged === false) {expect(status.configurable).toBe(false); await expect(h.control.set(true)).rejects.toThrow(/打包/);}
    }
  });
  it('preserves a failed default registration across restart without retrying', async () => {
    const h = loginHarness({readError: missing()}); h.api.set = () => {throw new Error('PRIVATE KEY');};
    expect((await h.control.initialize()).errors.map(e => e.code)).toContain('login-system-write');
    const restart = loginHarness({raw: h.text()});
    const status = await restart.control.initialize(); expect(restart.sets).toHaveLength(0);
    expect(status.requestedPreference).toBe(true); expect(status.errors.map(e => e.code)).toContain('login-system-write');
    expect(JSON.stringify(status)).not.toContain('PRIVATE');
  });
  it('reports macOS approval and unknown read status instead of disabled', async () => {
    const h = loginHarness(); h.native.openAtLogin = true; h.native.status = 'requires-approval';
    expect((await h.control.initialize()).mac?.status).toBe('requires-approval');
    h.api.get = () => {throw new Error('PRIVATE');};
    const status = await h.control.status(); expect(status.openAtLogin).toBeNull();
    expect(status.errors.map(e => e.code)).toContain('login-system-read'); expect(JSON.stringify(status)).not.toContain('PRIVATE');
  });
  it('uses identical Windows identity/path/args for writes and queries and reports system disablement', async () => {
    const h = loginHarness({platform: 'win32'}); await h.control.initialize(); await h.control.set(true);
    const options = {name: 'dev.growthworkbench.app', path: 'C:\\Users\\User\\Workbench\\学习工作台.exe', args: []};
    expect(h.sets).toEqual([{...options, openAtLogin: true, enabled: true}]);
    expect(h.queries.every(query => JSON.stringify(query) === JSON.stringify(options))).toBe(true);
    h.native.executableWillLaunchAtLogin = false;
    h.native.launchItems = [{...options, scope: 'user', enabled: false}];
    const status = await h.control.status(); expect(status.openAtLogin).toBe(true);
    expect(status.windows?.executableWillLaunchAtLogin).toBe(false); expect(status.windows?.launchItems[0].enabled).toBe(false);
  });
  it('uses the same Windows options for its authorized first registration only', async () => {
    const h = loginHarness({platform: 'win32', readError: missing()}); await h.control.initialize();
    expect(h.sets).toEqual([{name: 'dev.growthworkbench.app', path: 'C:\\Users\\User\\Workbench\\学习工作台.exe', args: [], openAtLogin: true, enabled: true}]);
    h.native.openAtLogin = false; await h.control.status(); expect(h.sets).toHaveLength(1);
  });
  it('rejects non-booleans before writing intent or OS state', async () => {
    const h = loginHarness(); await h.control.initialize();
    for (const input of [null, 'true', 1, {}, undefined]) await expect(h.control.set(input)).rejects.toThrow(/boolean/);
    expect(h.writes).toHaveLength(0); expect(h.sets).toHaveLength(0);
  });
  it('does not apply an OS change when intent storage fails', async () => {
    const h = loginHarness(); await h.control.initialize(); h.storage.write = async () => {throw new Error('PRIVATE');};
    const status = await h.control.set(true); expect(status.requestedPreference).toBe(false);
    expect(status.errors.map(e => e.code)).toContain('login-write'); expect(h.sets).toHaveLength(0);
  });
  it('distinguishes a failed registration diagnostic write from a failed intent write', async () => {
    const h = loginHarness(); await h.control.initialize(); let writes = 0;
    h.storage.write = async () => {if (++writes > 1) throw new Error('PRIVATE');};
    h.api.set = () => {throw new Error('PRIVATE');};
    const status = await h.control.set(true); expect(status.requestedPreference).toBe(true);
    expect(status.errors.map(error => error.code)).toEqual(['login-system-write', 'login-registration-write']);
    expect(status.errors.some(error => error.message.includes('未申请修改'))).toBe(false);
  });
  it('serializes concurrent intent writes, native changes and returned status', async () => {
    const h = loginHarness(); await h.control.initialize(); const firstWrite = deferred<void>(), entered = deferred<void>(); const writes: string[] = [];
    h.storage.write = async text => {writes.push(text); if (writes.length === 1) {entered.resolve(); await firstWrite.promise;}};
    const first = h.control.set(true), second = h.control.set(false); await entered.promise;
    expect(writes).toHaveLength(1); expect(h.sets).toHaveLength(0); firstWrite.resolve();
    expect((await first).requestedPreference).toBe(true); expect((await second).requestedPreference).toBe(false);
    expect(h.sets).toEqual([{openAtLogin: true}, {openAtLogin: false}]);
  });
});

class FakeNotification extends EventEmitter {showAction = () => {}; show() {this.showAction();}}
function notificationHarness(raw?: string) {
  let text = raw; let now = new Date(2026, 9, 5, 21, 0); let sequence = 0, supportCalls = 0;
  const due = {time: '20:00', enabled: true, checkedIn: false, startDate: ''};
  const writes: string[] = [], natives: FakeNotification[] = [], payloads: Array<{title: string; body: string}> = [];
  const storage = {read: async () => {if (text === undefined) throw missing(); return text;}, write: async (value: string) => {text = value; writes.push(value);}};
  const native = {supported: () => {supportCalls++; return true;}, create: (payload: {title: string; body: string}) => {payloads.push(payload); const notification = new FakeNotification(); natives.push(notification); return notification;}};
  const focus = vi.fn();
  const control = new NotificationControls({storage, native, focus, dailySettings: () => ({...due}), now: () => now, requestId: () => `request-${++sequence}`, callbackWaitMs: 10, retentionMs: 1000});
  return {control, storage, native, focus, writes, natives, payloads, due, supportCalls: () => supportCalls, text: () => text, setNow: (value: Date) => {now = value;}};
}
async function finishTest(h: ReturnType<typeof notificationHarness>) {const pending = h.control.test(); await vi.advanceTimersByTimeAsync(10); return pending;}

describe('manual native notification test', () => {
  it('stays independent of reminder records, check-ins and due state', async () => {
    vi.useFakeTimers(); const h = notificationHarness(); await h.control.initialize();
    const pending = h.control.test(); h.natives[0].emit('show'); const result = await pending;
    expect(result.status).toBe('shown'); expect(h.control.status().lastAttempt).toBeNull(); expect(h.writes).toHaveLength(0);
    expect(h.payloads[0].body).toMatch(/测试/); h.due.checkedIn = true; expect(await h.control.checkDaily()).toBeNull();
    expect(h.natives).toHaveLength(1); h.natives[0].emit('click'); expect(h.focus).toHaveBeenCalledOnce();
  });
  it.each(['unsupported', 'support-throw', 'construct-throw', 'show-throw', 'failed'])('exposes native failure %s without raw diagnostics or daily writes', async mode => {
    vi.useFakeTimers(); const h = notificationHarness(); await h.control.initialize();
    if (mode === 'unsupported') h.native.supported = () => false;
    if (mode === 'support-throw') h.native.supported = () => {throw new Error('PRIVATE');};
    if (mode === 'construct-throw') h.native.create = () => {throw new Error('PRIVATE');};
    if (mode === 'show-throw') {const create = h.native.create; h.native.create = p => {const n = create(p); n.showAction = () => {throw new Error('PRIVATE');}; return n;};}
    const pending = h.control.test(); if (mode === 'failed') h.natives[0].emit('failed', {}, 'PRIVATE');
    const result = await pending; expect(result.status).toBe(mode === 'unsupported' ? 'unsupported' : 'failed');
    expect(h.writes).toHaveLength(0); expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it('reports no callback as requested, accepts a late callback, and guards old requests', async () => {
    vi.useFakeTimers(); const h = notificationHarness(); await h.control.initialize();
    expect((await finishTest(h)).status).toBe('requested'); h.natives[0].emit('show'); expect(h.control.testStatus()?.status).toBe('shown');
    const newer = await finishTest(h); h.natives[0].emit('failed', {}, 'old');
    expect(h.control.testStatus()?.requestId).toBe(newer.requestId); expect(h.control.testStatus()?.status).toBe('requested');
    h.natives[1].emit('failed', {}, 'late'); expect(h.control.testStatus()?.status).toBe('failed');
  });
  it('attaches callbacks before show and keeps a confirmed terminal result', async () => {
    vi.useFakeTimers(); const h = notificationHarness(); const create = h.native.create;
    h.native.create = p => {const n = create(p); n.showAction = () => {n.emit('show'); n.emit('failed', {}, 'after shown');}; return n;};
    expect((await h.control.test()).status).toBe('shown');
  });
  it('ordinary cached queries do not initialize native notification support', async () => {
    const h = notificationHarness(); h.native.supported = () => {throw new Error('query must not initialize presenter');};
    await h.control.initialize(); expect(h.control.status().lastAttempt).toBeNull(); expect(h.control.testStatus()).toBeNull();
  });
  it('manual tests remain available when daily history cannot be read', async () => {
    vi.useFakeTimers(); const h = notificationHarness('broken'); await h.control.initialize();
    const pending = h.control.test(); h.natives[0].emit('show'); expect((await pending).status).toBe('shown');
    expect(h.control.status().readError?.code).toBe('reminder-read'); expect(h.writes).toHaveLength(0);
    expect(await h.control.checkDaily()).toBeNull();
  });
  it('removes native callback listeners after its finite retention window', async () => {
    vi.useFakeTimers(); const h = notificationHarness(); await h.control.initialize(); await finishTest(h);
    await vi.advanceTimersByTimeAsync(1000); h.natives[0].emit('show'); h.natives[0].emit('click');
    expect(h.control.testStatus()?.status).toBe('requested'); expect(h.focus).not.toHaveBeenCalled();
  });
});

describe('daily once-per-local-day attempts', () => {
  it.each([
    {change: {checkedIn: true}, reason: 'checked-in'},
    {change: {enabled: false}, reason: 'disabled'},
    {change: {time: '22:00'}, reason: 'not-due'},
    {change: {startDate: '2026-10-06'}, reason: 'not-due'},
  ])('suppresses a reserved attempt when current eligibility changes during storage: $reason $change', async ({change, reason}) => {
    vi.useFakeTimers(); const h = notificationHarness(); await h.control.initialize();
    const entered = deferred<void>(), saved = deferred<void>(), write = h.storage.write; let calls = 0;
    h.storage.write = async text => {if (++calls === 1) {entered.resolve(); await saved.promise;} await write(text);};
    const pending = h.control.checkDaily(); await entered.promise;
    Object.assign(h.due, change); saved.resolve(); await vi.advanceTimersByTimeAsync(10);
    const result = await pending;
    expect(result?.status).toBe('suppressed'); expect(result?.suppressionReason).toBe(reason);
    expect(h.supportCalls()).toBe(0); expect(h.payloads).toHaveLength(0); expect(h.natives).toHaveLength(0);
    expect(JSON.parse(h.text()!).status).toBe('suppressed'); expect(JSON.parse(h.text()!).date).toBe('2026-10-05');
    Object.assign(h.due, {enabled: true, checkedIn: false, time: '20:00', startDate: ''});
    expect(await h.control.checkDaily()).toBeNull();
    const restart = notificationHarness(h.text()); await restart.control.initialize();
    expect(restart.control.status().readError).toBeNull(); expect(restart.control.status().lastAttempt?.status).toBe('suppressed');
    expect(await restart.control.checkDaily()).toBeNull(); expect(restart.supportCalls()).toBe(0);
  });
  it('suppresses the persisted old-date attempt before native support when the local day changes', async () => {
    vi.useFakeTimers(); const h = notificationHarness(); await h.control.initialize();
    const entered = deferred<void>(), saved = deferred<void>(), write = h.storage.write; let calls = 0;
    h.storage.write = async text => {if (++calls === 1) {entered.resolve(); await saved.promise;} await write(text);};
    const pending = h.control.checkDaily(); await entered.promise; h.setNow(new Date(2026, 9, 6, 21, 0)); saved.resolve();
    await vi.advanceTimersByTimeAsync(10); const result = await pending;
    expect(result?.status).toBe('suppressed'); expect(result?.suppressionReason).toBe('date-changed');
    expect(h.supportCalls()).toBe(0); expect(h.natives).toHaveLength(0); expect(JSON.parse(h.text()!).date).toBe('2026-10-05');
  });
  it('does not send or persist an old suppression over a newer reserved date', async () => {
    vi.useFakeTimers(); const h = notificationHarness(); await h.control.initialize();
    const entered = deferred<void>(), saved = deferred<void>(), write = h.storage.write; let calls = 0;
    h.storage.write = async text => {if (++calls === 1) {entered.resolve(); await saved.promise;} await write(text);};
    const first = h.control.checkDaily(); await entered.promise; h.setNow(new Date(2026, 9, 6, 21, 0));
    const second = h.control.checkDaily(); await tick(); await tick(); saved.resolve();
    await vi.advanceTimersByTimeAsync(10); const old = await first;
    expect(old?.date).toBe('2026-10-05'); expect(old?.status).toBe('suppressed'); expect(old?.suppressionReason).toBe('superseded');
    expect((await second)?.date).toBe('2026-10-06'); expect(h.supportCalls()).toBe(1); expect(h.natives).toHaveLength(1);
    expect(h.writes.map(text => JSON.parse(text).date)).toEqual(['2026-10-05', '2026-10-06']);
    expect(h.control.status().lastAttempt?.date).toBe('2026-10-06'); expect(JSON.parse(h.text()!).date).toBe('2026-10-06');
  });
  it.each(['attempted', 'shown', 'unsupported'])('restores validated legacy %s as an attempt', async status => {
    const h = notificationHarness(JSON.stringify({date: '2026-10-05', status, at: '2026-10-05T12:00:00.000Z'}));
    await h.control.initialize(); expect(h.control.status().lastAttempt?.date).toBe('2026-10-05');
    expect(await h.control.checkDaily()).toBeNull(); expect(h.natives).toHaveLength(0);
  });
  it.each([
    {date: '2026-02-30', status: 'shown', at: '2026-10-05T00:00:00Z'},
    {date: '2026-10-05', status: 'made-up', at: '2026-10-05T00:00:00Z'},
    {date: '2026-10-05', status: 'shown', at: 'bad'}, [], null,
    {date: '2026-10-05', status: 'shown', at: '2026-02-30T00:00:00Z'},
    {date: '2026-10-05', status: 'shown', at: '2026-10-05T25:00:00Z'},
    {date: '2026-10-05', status: 'requested', at: '2026-10-05T00:00:00Z'},
  ])('reports malformed history and defers automatic sends without assuming a valid date: %j', async raw => {
    const h = notificationHarness(JSON.stringify(raw)); await h.control.initialize();
    expect(h.control.status().lastAttempt).toBeNull(); expect(h.control.status().readError?.code).toBe('reminder-read');
    expect(await h.control.checkDaily()).toBeNull(); expect(h.writes).toHaveLength(0);
  });
  it.each(['failed', 'unsupported'])('records %s once, including across restart', async status => {
    vi.useFakeTimers(); const h = notificationHarness(); await h.control.initialize();
    if (status === 'unsupported') h.native.supported = () => false;
    const pending = h.control.checkDaily(); await vi.advanceTimersByTimeAsync(0);
    if (status === 'failed') h.natives[0].emit('failed', {}, 'PRIVATE');
    expect((await pending)?.status).toBe(status); expect(await h.control.checkDaily()).toBeNull();
    const restart = notificationHarness(h.text()); await restart.control.initialize();
    expect(await restart.control.checkDaily()).toBeNull(); expect(restart.natives).toHaveLength(0);
  });
  it('reserves date before storage, and sends only after initial persistence succeeds', async () => {
    vi.useFakeTimers(); const h = notificationHarness(); await h.control.initialize(); const stored = deferred<void>(), entered = deferred<void>();
    h.storage.write = async text => {h.writes.push(text); entered.resolve(); await stored.promise;};
    const first = h.control.checkDaily(); await entered.promise; const second = h.control.checkDaily();
    expect(h.natives).toHaveLength(0); expect(h.writes).toHaveLength(1); stored.resolve();
    await vi.advanceTimersByTimeAsync(10); expect((await first)?.status).toBe('requested'); expect(await second).toBeNull(); expect(h.natives).toHaveLength(1);
  });
  it('suppresses same-process repeated attempts if initial storage fails and reports storage error', async () => {
    const h = notificationHarness(); await h.control.initialize(); h.storage.write = async () => {throw new Error('PRIVATE');};
    const first = await h.control.checkDaily(); expect(first?.status).toBe('failed'); expect(first?.error?.message).toContain('通知未发送');
    expect(h.control.status().storageError?.code).toBe('reminder-write'); expect(h.natives).toHaveLength(0);
    expect(await h.control.checkDaily()).toBeNull(); expect(JSON.stringify(h.control.status())).not.toContain('PRIVATE');
  });
  it('reports terminal persistence failure after a confirmed show without changing the shown result', async () => {
    vi.useFakeTimers(); const h = notificationHarness(); await h.control.initialize();
    const write = h.storage.write; let calls = 0;
    h.storage.write = async text => {if (++calls > 1) throw new Error('PRIVATE'); await write(text);};
    const pending = h.control.checkDaily(); await vi.advanceTimersByTimeAsync(0); h.natives[0].emit('show');
    expect((await pending)?.status).toBe('shown'); expect(h.control.status().storageError?.code).toBe('reminder-write');
    expect(JSON.parse(h.text()!).status).toBe('requested'); expect(await h.control.checkDaily()).toBeNull();
  });
  it('daily callbacks cannot overwrite the independent manual test result', async () => {
    vi.useFakeTimers(); const h = notificationHarness(); await h.control.initialize();
    const dailyRequest = h.control.checkDaily(); await vi.advanceTimersByTimeAsync(10); await dailyRequest;
    const manual = await finishTest(h); h.natives[0].emit('failed', {}, 'old daily error'); await tick();
    expect(h.control.status().lastAttempt?.status).toBe('failed');
    expect(h.control.testStatus()?.requestId).toBe(manual.requestId); expect(h.control.testStatus()?.status).toBe('requested');
  });
  it('serializes terminal file writes and prevents a late old day callback overwriting the new day', async () => {
    vi.useFakeTimers(); const h = notificationHarness(); await h.control.initialize();
    const first = h.control.checkDaily(); await vi.advanceTimersByTimeAsync(10); await first;
    h.setNow(new Date(2026, 9, 6, 21, 0)); const next = h.control.checkDaily(); await vi.advanceTimersByTimeAsync(10); await next;
    h.natives[0].emit('show'); await tick(); expect(h.control.status().lastAttempt?.date).toBe('2026-10-06');
    expect(JSON.parse(h.text()!).date).toBe('2026-10-06');
    let active = 0, peak = 0; const gate = deferred<void>();
    h.storage.write = async text => {active++; peak = Math.max(peak, active); h.writes.push(text); await gate.promise; active--;};
    h.natives[1].emit('show'); await tick(); h.setNow(new Date(2026, 9, 7, 21, 0)); const third = h.control.checkDaily(); await tick();
    expect(peak).toBe(1); gate.resolve(); await vi.advanceTimersByTimeAsync(10); await third; expect(peak).toBe(1);
    expect(h.control.status().lastAttempt?.date).toBe('2026-10-07');
  });
});
