import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserReader, prepareBrowserSpeech, resolveBrowserVoice, type BrowserReadRequest, type BrowserSpeechEnvironment, type BrowserVoice } from '../src/browser/speech';

const local = { voiceURI: 'local-zh', name: '同名', lang: 'zh-CN', localService: true, default: true } as SpeechSynthesisVoice;
const remote = { voiceURI: 'remote-zh', name: '同名', lang: 'zh-CN', localService: false, default: true } as SpeechSynthesisVoice;
const english = { voiceURI: 'en', name: 'English', lang: 'en-US', localService: true, default: false } as SpeechSynthesisVoice;
function metadata(voice: SpeechSynthesisVoice): BrowserVoice {
  const service = voice.localService === true ? 'local' : voice.localService === false ? 'remote' : 'unknown';
  return { id: JSON.stringify([voice.voiceURI, voice.name, voice.lang, service]), voiceURI: voice.voiceURI, name: voice.name, lang: voice.lang, service, isDefault: voice.default };
}
function harness(initial: SpeechSynthesisVoice[] = [local]) {
  vi.useFakeTimers();
  const synth = Object.assign(new EventTarget(), {
    voices: initial, paused: false,
    getVoices(): SpeechSynthesisVoice[] { return this.voices; },
    speak: vi.fn<(utterance: SpeechSynthesisUtterance) => void>(),
    cancel: vi.fn<() => void>(),
    resume: vi.fn<() => void>(),
  });
  const document = Object.assign(new EventTarget(), { hidden: false });
  const window = new EventTarget();
  const utterances: SpeechSynthesisUtterance[] = [];
  const environment: BrowserSpeechEnvironment = {
    synth, document, window,
    createUtterance: text => {
      const u = { text, lang: '', voice: null, rate: 1, pitch: 1, volume: 1, onstart: null, onend: null, onerror: null } as SpeechSynthesisUtterance;
      utterances.push(u); return u;
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const reader = createBrowserReader(environment);
  function request(text = '你好。', extras: Partial<BrowserReadRequest> = {}): BrowserReadRequest {
    return { scope: 'main:one', itemId: 'one', text, format: 'plain', preferences: { voiceId: null, language: 'zh-CN', rate: 1 }, expectedVoice: { id: metadata(local).id, service: 'local' }, ...extras };
  }
  function event(kind: 'start' | 'end' | 'error', index = utterances.length - 1, error = 'network') {
    const u = utterances[index];
    const handler = u[`on${kind}`];
    (handler as ((event: unknown) => void) | null)?.call(u, { error });
  }
  return { reader, synth, document, window, environment, request, event, utterances };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('browser speech pure contracts', () => {
  it('preserves plain markup and all whitespace through safe Unicode chunks', () => {
    const source = ' _literal_*` <speak>hello</speak>\n' + ('甲'.repeat(239) + '😀\n').repeat(210) + '尾  ';
    const prepared = prepareBrowserSpeech(source, 'plain');
    expect(prepared.text).toBe(source);
    expect(prepared.chunks.join('')).toBe(source);
    expect(prepared.chunks.every(c => c.length <= 240 && !/[\uD800-\uDBFF]$/.test(c) && !/^[\uDC00-\uDFFF]/.test(c))).toBe(true);
  });
  it('omits closed, longer, tilde and unclosed fences and reads link labels', () => {
    const source = '# 标题\n[链接](https://example.com) ![图](image.png)\n````js\nsecret1\n```\nstillSecret\n````\n~~~py\nsecret2\n~~~\n尾\n```\nsecret3';
    expect(prepareBrowserSpeech(source, 'markdown').text).toBe('标题\n链接 图\n代码段已略过。\n代码段已略过。\n尾\n代码段已略过。');
  });
  it('rejects oversized, blank and non-string inputs without truncating', () => {
    expect(() => prepareBrowserSpeech('甲'.repeat(100001), 'plain')).toThrow();
    expect(() => prepareBrowserSpeech(' \n ', 'plain')).toThrow();
    expect(() => prepareBrowserSpeech(null as unknown as string, 'plain')).toThrow();
    expect(prepareBrowserSpeech('甲'.repeat(100000), 'plain').chunks.join('')).toHaveLength(100000);
  });
  it('chooses language layers with local priority and never substitutes an explicit missing voice', () => {
    const zhTW = metadata({ ...local, voiceURI: 'tw', lang: 'zh-TW' } as SpeechSynthesisVoice);
    const prefs = { voiceId: null, language: 'zh-CN' as const, rate: 1 as const };
    expect(resolveBrowserVoice([metadata(remote), metadata(local)], prefs).voice?.service).toBe('local');
    expect(resolveBrowserVoice([metadata(english), zhTW], prefs)).toEqual({ voice: zhTW, fallback: 'language-family' });
    expect(resolveBrowserVoice([metadata(english)], prefs)).toEqual({ voice: null, fallback: 'browser-default' });
    expect(resolveBrowserVoice([metadata(remote)], { ...prefs, voiceId: 'gone' }).voice).toBeNull();
  });
});

describe('browser speech lifecycle', () => {
  it('imports and remains controlled without globals or with each missing required API', () => {
    expect(createBrowserReader({}).snapshot().supported).toBe(false);
    for (const key of ['speak', 'cancel', 'getVoices', 'addEventListener', 'removeEventListener'] as const) {
      const h = harness();
      const synth = Object.assign(Object.create(h.synth), { [key]: undefined });
      const reader = createBrowserReader({ ...h.environment, synth });
      reader.read(h.request());
      expect(reader.snapshot()).toMatchObject({ supported: false, phase: 'error', errorCode: 'unsupported', active: null });
      expect(h.synth.speak).not.toHaveBeenCalled();
      reader.dispose(); h.reader.dispose();
    }
    expect(createBrowserReader({ synth: harness().synth }).snapshot().supported).toBe(false);
  });
  it('updates late voices, distinguishes same names and never speaks from list events', () => {
    const h = harness([]);
    expect(h.reader.snapshot().voicePhase).toBe('loading');
    vi.advanceTimersByTime(3000);
    expect(h.reader.snapshot().voicePhase).toBe('empty');
    h.synth.voices = [remote, local, local]; h.synth.dispatchEvent(new Event('voiceschanged'));
    expect(h.reader.snapshot().voices).toHaveLength(2);
    expect(new Set(h.reader.snapshot().voices.map(v => v.id)).size).toBe(2);
    const snapshot = h.reader.snapshot(); (snapshot.voices[0] as { name: string }).name = 'modified';
    expect(h.reader.snapshot().voices.some(v => v.name === 'modified')).toBe(false);
    h.reader.refreshVoices(); expect(h.synth.speak).not.toHaveBeenCalled(); h.reader.dispose();
  });
  it('starts synchronously with the runtime voice and queues exactly one chunk', () => {
    const h = harness(); const text = '甲'.repeat(500);
    const request = h.request(text); h.reader.read(request);
    request.text = 'changed'; request.preferences.rate = 1.5;
    expect(h.synth.speak).toHaveBeenCalledTimes(1);
    expect(h.utterances[0]).toMatchObject({ lang: 'zh-CN', voice: local, rate: 1, pitch: 1, volume: 1 });
    expect(h.utterances[0].voice).toBe(local);
    expect(h.reader.snapshot()).toMatchObject({ phase: 'starting', active: { scope: 'main:one', itemId: 'one', chunk: 1, chunks: 3 } });
    h.event('start'); expect(h.reader.snapshot().phase).toBe('speaking');
    h.event('end'); expect(h.synth.speak).toHaveBeenCalledTimes(2);
    h.event('end'); expect(h.synth.speak).toHaveBeenCalledTimes(3);
    h.event('end'); expect(h.reader.snapshot()).toMatchObject({ phase: 'completed', active: null });
    expect(h.utterances.map(u => u.text).join('')).toBe(text); h.reader.dispose();
  });
  it('requires another click when voice identity or reported origin changes', () => {
    const h = harness(); h.synth.voices = [remote]; h.reader.read(h.request());
    expect(h.reader.snapshot()).toMatchObject({ phase: 'error', errorCode: 'voice-changed', effectiveVoice: { service: 'remote' } });
    expect(h.synth.speak).not.toHaveBeenCalled();
    h.reader.read(h.request('你好', { expectedVoice: { id: metadata(remote).id, service: 'remote' } }));
    expect(h.synth.speak).toHaveBeenCalledTimes(1); h.reader.dispose();
  });
  it('stops if an explicit voice disappears before the next chunk', () => {
    const h = harness(); h.reader.read(h.request('甲'.repeat(500), { preferences: { voiceId: metadata(local).id, language: 'en-US', rate: 0.75 } }));
    expect(h.utterances[0].lang).toBe('zh-CN');
    h.synth.voices = [remote]; h.synth.dispatchEvent(new Event('voiceschanged')); h.event('end');
    expect(h.synth.speak).toHaveBeenCalledTimes(1);
    expect(h.reader.snapshot()).toMatchObject({ active: null, errorCode: 'voice-unavailable' }); h.reader.dispose();
  });
  it('invalidates before cancel and ignores saved synchronous or delayed callbacks', () => {
    const h = harness(); h.reader.read(h.request('甲'.repeat(500)));
    const old = { start: h.utterances[0].onstart, end: h.utterances[0].onend, error: h.utterances[0].onerror };
    h.synth.cancel.mockImplementation(() => (old.error as Function)({ error: 'interrupted' }));
    h.reader.read(h.request('new', { itemId: 'two' }));
    const expected = h.reader.snapshot();
    for (const handler of Object.values(old)) (handler as Function)({ error: 'network' });
    expect(h.reader.snapshot()).toEqual(expected); expect(h.synth.speak).toHaveBeenCalledTimes(2);
    h.reader.stop('update'); expect(h.reader.snapshot()).toMatchObject({ phase: 'stopped', active: null });
    vi.advanceTimersByTime(200000); expect(h.reader.snapshot().phase).toBe('stopped'); h.reader.dispose();
  });
  it('bounds missing start and completion without replay and allows a later explicit retry', () => {
    const h = harness(); h.reader.read(h.request()); vi.advanceTimersByTime(10000);
    expect(h.reader.snapshot()).toMatchObject({ phase: 'error', active: null, errorCode: 'start-timeout' });
    expect(h.synth.speak).toHaveBeenCalledTimes(1);
    h.reader.read(h.request()); h.event('start'); vi.advanceTimersByTime(119999);
    expect(h.reader.snapshot().phase).toBe('speaking'); vi.advanceTimersByTime(1);
    expect(h.reader.snapshot()).toMatchObject({ phase: 'error', active: null, errorCode: 'completion-timeout' });
    expect(h.synth.speak).toHaveBeenCalledTimes(2); h.reader.dispose();
  });
  it('stops hidden/pagehide and refuses hidden read without restarting on return', () => {
    const h = harness(); h.reader.read(h.request()); h.document.hidden = true; h.document.dispatchEvent(new Event('visibilitychange'));
    expect(h.reader.snapshot()).toMatchObject({ phase: 'stopped', active: null });
    h.reader.read(h.request()); expect(h.synth.speak).toHaveBeenCalledTimes(1);
    h.document.hidden = false; h.document.dispatchEvent(new Event('visibilitychange')); h.window.dispatchEvent(new Event('pageshow'));
    expect(h.synth.speak).toHaveBeenCalledTimes(1);
    h.reader.read(h.request()); h.window.dispatchEvent(new Event('pagehide'));
    expect(h.reader.snapshot()).toMatchObject({ phase: 'stopped', active: null }); h.reader.dispose();
  });
  it('removes subscriptions/timers idempotently and old cleanup cannot cancel a successor', () => {
    const h = harness(); const listener = vi.fn(); const unsubscribe = h.reader.subscribe(listener);
    h.reader.read(h.request()); unsubscribe(); const calls = listener.mock.calls.length;
    const next = createBrowserReader(h.environment); next.read(h.request());
    const canceled = h.synth.cancel.mock.calls.length; h.reader.dispose(); h.reader.dispose(); h.reader.stop();
    expect(h.synth.cancel).toHaveBeenCalledTimes(canceled); expect(listener).toHaveBeenCalledTimes(calls);
    expect(next.snapshot().phase).toBe('starting'); next.dispose();
    h.window.dispatchEvent(new Event('pagehide')); h.synth.dispatchEvent(new Event('voiceschanged')); vi.advanceTimersByTime(200000);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('prevents submission on cancel throw, sanitizes error and retries only explicitly', () => {
    const h = harness(); h.reader.read(h.request()); h.synth.cancel.mockImplementationOnce(() => { throw new Error('PRIVATE TEXT stack'); });
    h.reader.read(h.request('replacement')); expect(h.synth.speak).toHaveBeenCalledTimes(1);
    expect(h.reader.snapshot()).toMatchObject({ phase: 'error', errorCode: 'cancel-failed', active: null });
    expect(JSON.stringify(h.reader.snapshot())).not.toContain('PRIVATE');
    h.reader.read(h.request()); expect(h.synth.speak).toHaveBeenCalledTimes(2); h.reader.dispose();
  });
  it.each(['not-allowed', 'voice-unavailable', 'language-unavailable', 'network', 'audio-busy', 'audio-hardware', 'canceled', 'interrupted', 'text-too-long', 'synthesis-unavailable', 'synthesis-failed', 'PRIVATE secret'])('stops error %s without remote retry', error => {
    const h = harness(); h.reader.read(h.request('甲'.repeat(500))); h.event('error', 0, error);
    expect(h.reader.snapshot()).toMatchObject({ phase: 'error', active: null });
    expect(h.reader.snapshot().errorCode).toBe(error.startsWith('PRIVATE') ? 'speech-failed' : error);
    expect(h.synth.speak).toHaveBeenCalledTimes(1); vi.advanceTimersByTime(200000); expect(h.synth.speak).toHaveBeenCalledTimes(1); h.reader.dispose();
  });
  it('controls getVoices, utterance constructor and speak throws', () => {
    for (const stage of ['voices', 'constructor', 'speak'] as const) {
      const h = harness();
      if (stage === 'voices') vi.spyOn(h.synth, 'getVoices').mockImplementation(() => { throw new Error('private'); });
      if (stage === 'constructor') h.environment.createUtterance = () => { throw new Error('private'); };
      if (stage === 'speak') h.synth.speak.mockImplementation(() => { throw new Error('private'); });
      const reader = stage === 'constructor' ? createBrowserReader(h.environment) : h.reader;
      expect(() => reader.read(h.request())).not.toThrow();
      expect(reader.snapshot()).toMatchObject({ phase: 'error', active: null });
      expect(JSON.stringify(reader.snapshot())).not.toContain('private'); reader.dispose(); h.reader.dispose();
    }
  });
  it('resumes a paused synth only on explicit read and rejects an ineffective resume', () => {
    const h = harness(); h.synth.paused = true; h.reader.read(h.request());
    expect(h.reader.snapshot()).toMatchObject({ phase: 'error', errorCode: 'paused', active: null }); expect(h.synth.speak).not.toHaveBeenCalled();
    h.synth.resume.mockImplementation(() => { h.synth.paused = false; }); h.reader.read(h.request());
    expect(h.synth.speak).toHaveBeenCalledTimes(1); h.reader.dispose();
  });
});

describe('browser speech defensive event edges', () => {
  it('keeps runtime language spelling while using canonical language in identity', () => {
    const lowerCase = { ...local, lang: 'zh-cn' } as SpeechSynthesisVoice;
    const h = harness([lowerCase]); h.reader.read(h.request());
    expect(h.reader.snapshot().voices[0].id).toBe('["local-zh","同名","zh-CN","local"]');
    expect(h.reader.snapshot().effectiveVoice?.lang).toBe('zh-cn');
    expect(h.utterances[0].lang).toBe('zh-cn'); h.reader.dispose();
  });
  it('does not let stale selection overwrite a read started by a subscriber', () => {
    const h = harness([local, english]); let replaced = false;
    h.reader.subscribe(() => {
      if (replaced) return; replaced = true;
      h.reader.read(h.request('English', { itemId: 'english', preferences: { voiceId: null, language: 'en-US', rate: 1 }, expectedVoice: { id: metadata(english).id, service: 'local' } }));
    });
    h.reader.read(h.request());
    expect(h.synth.speak).toHaveBeenCalledTimes(1);
    expect(h.reader.snapshot()).toMatchObject({ active: { itemId: 'english' }, effectiveVoice: { lang: 'en-US' }, requestedLanguage: 'en-US' });
    h.reader.dispose();
  });
  it('contains API getter and lifecycle registration throws and still permits cleanup', () => {
    const h = harness(); const throwing = Object.create(h.synth);
    Object.defineProperty(throwing, 'speak', { get() { throw new Error('PRIVATE'); } });
    let reader = h.reader;
    expect(() => { reader = createBrowserReader({ ...h.environment, synth: throwing }); }).not.toThrow();
    expect(reader.snapshot().supported).toBe(false); reader.dispose();
    const add = vi.spyOn(h.document, 'addEventListener').mockImplementation(() => { throw new Error('PRIVATE'); });
    const failed = createBrowserReader(h.environment); failed.read(h.request());
    expect(failed.snapshot()).toMatchObject({ phase: 'error', errorCode: 'environment-failed', active: null });
    expect(h.synth.speak).not.toHaveBeenCalled();
    add.mockRestore(); failed.dispose(); h.reader.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it('clears voice-list failure feedback after a successful manual refresh', () => {
    const h = harness(); const get = vi.spyOn(h.synth, 'getVoices').mockImplementationOnce(() => { throw new Error('PRIVATE'); });
    h.reader.refreshVoices(); expect(h.reader.snapshot()).toMatchObject({ voicePhase: 'failed', errorCode: 'voices-failed' });
    get.mockRestore(); h.reader.refreshVoices();
    expect(h.reader.snapshot()).toMatchObject({ voicePhase: 'ready', errorCode: null }); expect(h.synth.speak).not.toHaveBeenCalled(); h.reader.dispose();
  });
  it('handles synchronous start/end, duplicate start and saved old end with no timer leakage', () => {
    const h = harness(); h.synth.speak.mockImplementation(u => {
      (u.onstart as Function)({}); (u.onstart as Function)({}); (u.onend as Function)({});
    });
    h.reader.read(h.request('甲'.repeat(500)));
    expect(h.synth.speak).toHaveBeenCalledTimes(3);
    expect(h.reader.snapshot()).toMatchObject({ phase: 'completed', active: null }); expect(vi.getTimerCount()).toBe(0); h.reader.dispose();
  });
  it('rechecks auto-choice origin between chunks and does not mutate submitted utterances', () => {
    const h = harness(); h.reader.read(h.request('甲'.repeat(500)));
    const original = h.utterances[0]; h.synth.voices = [{ ...local, localService: false } as SpeechSynthesisVoice]; h.event('end');
    expect(h.synth.speak).toHaveBeenCalledTimes(1);
    expect(h.reader.snapshot()).toMatchObject({ phase: 'error', errorCode: 'voice-changed', effectiveVoice: { service: 'remote' } });
    expect(original.voice).toBe(local); h.reader.dispose();
  });
  it('uses a newly returned runtime voice object for later chunks without changing settings', () => {
    const h = harness(); const request = h.request('甲'.repeat(500)); h.reader.read(request);
    const replacement = { ...local } as SpeechSynthesisVoice; h.synth.voices = [replacement]; request.preferences.rate = 1.5; h.event('end');
    expect(h.utterances[1].voice).toBe(replacement); expect(h.utterances[0].voice).toBe(local); expect(h.utterances[1].rate).toBe(1); h.reader.dispose();
  });
  it('refuses malformed metadata/rate/format and empty text with controlled feedback', () => {
    const h = harness();
    const invalid = [h.request('', { text: ' ' }), h.request('', { text: '甲'.repeat(100001) }), h.request('', { format: 'ssml' as 'plain' }), h.request('', { preferences: { voiceId: null, language: 'zh-CN', rate: NaN as 1 } }), null as unknown as BrowserReadRequest];
    for (const request of invalid) { expect(() => h.reader.read(request)).not.toThrow(); expect(h.reader.snapshot()).toMatchObject({ phase: 'error', active: null }); }
    expect(h.synth.speak).not.toHaveBeenCalled(); h.reader.dispose();
  });
  it('allows an explicit unknown browser default with requested language and no enumerated voice', () => {
    const h = harness([english]); h.reader.read(h.request('中文', { expectedVoice: { id: null, service: 'unknown' } }));
    expect(h.synth.speak).toHaveBeenCalledTimes(1); expect(h.utterances[0]).toMatchObject({ lang: 'zh-CN', voice: null });
    expect(h.reader.snapshot()).toMatchObject({ effectiveVoice: null, fallback: 'browser-default' }); h.reader.dispose();
  });
  it('controls clock throws and lifecycle removal throws without accepting stale events', () => {
    const h = harness(); h.environment.setTimeout = () => { throw new Error('PRIVATE'); };
    const reader = createBrowserReader(h.environment); expect(() => reader.read(h.request())).not.toThrow();
    expect(reader.snapshot()).toMatchObject({ phase: 'error', active: null }); expect(h.synth.speak).not.toHaveBeenCalled();
    vi.spyOn(h.window, 'removeEventListener').mockImplementation(() => { throw new Error('PRIVATE'); });
    expect(() => reader.dispose()).not.toThrow(); h.window.dispatchEvent(new Event('pagehide')); expect(h.synth.speak).not.toHaveBeenCalled(); h.reader.dispose();
  });
});

describe('accepted Task 1 review regressions', () => {
  it.each(['dispose', 'replacement'] as const)('rejects a stop subscriber read during %s and clears all old timers', action => {
    const h = harness(); h.reader.read(h.request()); let attempted = false;
    h.reader.subscribe(() => {
      if (attempted || h.reader.snapshot().phase !== 'stopped') return;
      attempted = true; h.reader.read(h.request('must not escape disposal', { itemId: 'reentrant' }));
    });
    const successor = action === 'replacement' ? createBrowserReader(h.environment) : null;
    if (!successor) h.reader.dispose();
    expect(attempted).toBe(true);
    expect(h.synth.speak).toHaveBeenCalledTimes(1);
    expect(h.reader.snapshot()).toMatchObject({ phase: 'stopped', active: null });
    expect(vi.getTimerCount()).toBe(0);
    if (successor) {
      successor.read(h.request('successor', { itemId: 'successor' }));
      const cancels = h.synth.cancel.mock.calls.length;
      h.reader.dispose(); h.reader.stop();
      expect(h.synth.cancel).toHaveBeenCalledTimes(cancels);
      expect(successor.snapshot()).toMatchObject({ phase: 'starting', active: { itemId: 'successor' } }); successor.dispose();
    }
  });
  it('does not let old disposal cleanup cancel an owner created by its stop subscriber', () => {
    const h = harness(); h.reader.read(h.request()); let successor: ReturnType<typeof createBrowserReader> | null = null;
    h.reader.subscribe(() => {
      if (successor || h.reader.snapshot().phase !== 'stopped') return;
      successor = createBrowserReader(h.environment);
      successor.read(h.request('successor', { itemId: 'successor' }));
    });
    h.reader.dispose();
    expect(h.synth.speak).toHaveBeenCalledTimes(2);
    expect(h.synth.cancel).toHaveBeenCalledTimes(3);
    expect(successor!.snapshot()).toMatchObject({ phase: 'starting', active: { itemId: 'successor' } });
    successor!.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    ['quoted tilde', '> ~~~js\n> privateCode1()\n> ~~~\n尾', '代码段已略过。\n尾'],
    ['nested quoted backtick', '> > ````js\n> > privateCode2()\n> > ```\n> > stillPrivate()\n> > ````\n尾', '代码段已略过。\n尾'],
    ['list indented tilde', '- 条目\n    ~~~js\n    privateCode3()\n    ~~~\n尾', '- 条目\n代码段已略过。\n尾'],
    ['ordered list backtick', '1. ```js\n   privateCode4()\n   ```\n尾', '代码段已略过。\n尾'],
    ['unclosed quoted backtick', '> ```js\n> privateCode5()', '代码段已略过。'],
    ['unclosed quoted list tilde', '> - ~~~js\n>   privateCode6()', '代码段已略过。'],
    ['unclosed list backtick', '- 条目\n  ```js\n  privateCode7()', '- 条目\n代码段已略过。'],
    ['nested list tilde', '- - ~~~js\n    privateCode8()\n    ~~~\n尾', '代码段已略过。\n尾'],
    ['quoted delimiter inside top-level code', '```js\n> ```\nprivateCode9()\n```\n尾', '代码段已略过。\n尾'],
    ['extra quote delimiter inside quoted code', '> ```js\n> > ```\n> privateCode10()\n> ```\n尾', '代码段已略过。\n尾'],
  ])('omits %s fences while keeping the plain input unchanged', (_name, source, expected) => {
    const prepared = prepareBrowserSpeech(source, 'markdown');
    expect(prepared.text).toBe(expected); expect(prepared.chunks.join('')).toBe(expected);
    expect(prepareBrowserSpeech(source, 'plain').chunks.join('')).toBe(source);
  });
  it('ignores an obsolete startup timer after start even if injected clearTimeout throws', () => {
    const h = harness(); h.environment.clearTimeout = () => { throw new Error('injected clock failure'); };
    const reader = createBrowserReader(h.environment); reader.read(h.request()); h.event('start');
    vi.advanceTimersByTime(10000);
    expect(reader.snapshot()).toMatchObject({ phase: 'speaking', errorCode: null, active: { itemId: 'one' } });
    expect(h.synth.speak).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(109999); expect(reader.snapshot().phase).toBe('speaking');
    vi.advanceTimersByTime(1); expect(reader.snapshot()).toMatchObject({ phase: 'error', errorCode: 'completion-timeout', active: null });
    expect(h.synth.speak).toHaveBeenCalledTimes(1); reader.dispose();
  });
});

describe('accepted fence closing indentation regression', () => {
  it.each([
    ['top-level backtick', '```js\n    ```\nsecret()\n```\nafter', '代码段已略过。\nafter'],
    ['top-level tilde', '~~~js\n    ~~~\nsecret()\n~~~\nafter', '代码段已略过。\nafter'],
    ['quoted backtick', '> ```js\n>     ```\n> secret()\n> ```\nafter', '代码段已略过。\nafter'],
    ['list structural indent', '- 条目\n    ```js\n      ```\n    secret()\n  ```\nafter', '- 条目\n代码段已略过。\nafter'],
    ['ordered-list structural indent', '1. ~~~js\n       ~~~\n   secret()\n   ~~~\nafter', '代码段已略过。\nafter'],
    ['quoted list structural indent', '> - 条目\n>   ~~~js\n>       ~~~\n>   secret()\n>   ~~~\nafter', '- 条目\n代码段已略过。\nafter'],
    ['valid three-extra-space close', '- 条目\n  ```js\n  secret()\n     ```\nafter', '- 条目\n代码段已略过。\nafter'],
  ])('keeps code omitted and trailing prose after the valid %s close', (_name, source, expected) => {
    const prepared = prepareBrowserSpeech(source, 'markdown');
    expect(prepared.text).toBe(expected); expect(prepared.chunks.join('')).toBe(expected);
    expect(prepareBrowserSpeech(source, 'plain').chunks.join('')).toBe(source);
  });
});
