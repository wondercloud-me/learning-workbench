/** Browser output only: no learner state, native speech or network dependencies. */
export type SpeechRate = 0.75 | 1 | 1.25 | 1.5;
export type VoiceService = 'local' | 'remote' | 'unknown';
export type BrowserVoice = { id: string; voiceURI: string; name: string; lang: string; service: VoiceService; isDefault: boolean };
export type BrowserSpeechPreferences = { voiceId: string | null; language: 'zh-CN' | 'en-US'; rate: SpeechRate };
export type BrowserReadRequest = {
  scope: string; itemId: string; text: string; format: 'plain' | 'markdown'; preferences: BrowserSpeechPreferences;
  expectedVoice: { id: string | null; service: VoiceService };
};
export type VoiceFallback = 'none' | 'language-family' | 'browser-default';
export type BrowserSpeechSnapshot = {
  supported: boolean; voicePhase: 'loading' | 'ready' | 'empty' | 'failed'; voices: readonly BrowserVoice[];
  phase: 'idle' | 'starting' | 'speaking' | 'stopped' | 'completed' | 'error';
  active: { scope: string; itemId: string; chunk: number; chunks: number } | null;
  effectiveVoice: BrowserVoice | null; requestedLanguage: string | null; fallback: VoiceFallback | null;
  notice: string; errorCode: string | null;
};
export type BrowserReader = {
  snapshot(): BrowserSpeechSnapshot; subscribe(listener: () => void): () => void; refreshVoices(): void;
  read(request: BrowserReadRequest): void; stop(reason?: 'user' | 'scope' | 'hidden' | 'restore' | 'update'): void; dispose(): void;
};
export type BrowserSpeechEnvironment = {
  synth?: Partial<Pick<SpeechSynthesis, 'speak' | 'cancel' | 'getVoices' | 'paused' | 'resume' | 'addEventListener' | 'removeEventListener'>> | null;
  createUtterance?: (text: string) => SpeechSynthesisUtterance;
  document?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
  window?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  setTimeout?: (callback: () => void, delay: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
};

class SpeechInputError extends Error {
  constructor(readonly code: 'invalid-request' | 'text-too-long' | 'empty-text') { super(code); }
}

/** Strip only leading Markdown containers to identify a fence, not its body text. */
function fenceContent(line: string): { text: string; quotes: number; list: boolean; indent: number; listIndent: number } {
  let content = line;
  let quotes = 0;
  let list = false;
  let indent = 0;
  let listIndent = 0;
  for (;;) {
    const whitespace = /^[ \t]*/.exec(content)![0];
    for (const character of whitespace) indent += character === '\t' ? 4 - indent % 4 : 1;
    content = content.slice(whitespace.length);
    const quote = /^>[ \t]?/.exec(content);
    if (quote) {
      quotes++; indent = 0; listIndent = 0;
      content = content.slice(quote[0].length); continue;
    }
    const prefix = /^(?:[-+*]|\d{1,9}[.)])[ \t]+/.exec(content);
    if (!prefix) return { text: content, quotes, list, indent, listIndent };
    list = true;
    for (const character of prefix[0]) indent += character === '\t' ? 4 - indent % 4 : 1;
    listIndent = indent;
    content = content.slice(prefix[0].length);
  }
}

/** No HTML/SSML parsing: the result is always ordinary utterance text. */
export function prepareBrowserSpeech(input: string, format: 'plain' | 'markdown'): { text: string; chunks: string[] } {
  if (typeof input !== 'string' || !['plain', 'markdown'].includes(format)) throw new SpeechInputError('invalid-request');
  if (input.length > 100_000) throw new SpeechInputError('text-too-long');
  let text = input;
  if (format === 'markdown') {
    let fence: { char: string; length: number; quotes: number; containerIndent: number } | null = null;
    let listContext: { quotes: number; indent: number } | null = null;
    const lines: string[] = [];
    for (const line of input.split('\n')) {
      const container = fenceContent(line);
      const marker = /^(`{3,}|~{3,})(.*)$/.exec(container.text);
      if (fence) {
        if (marker && container.quotes === fence.quotes && !container.list
          && container.indent >= fence.containerIndent && container.indent <= fence.containerIndent + 3
          && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
        continue;
      }
      if (container.list) listContext = { quotes: container.quotes, indent: container.listIndent };
      else if (container.text && listContext && (container.quotes !== listContext.quotes || container.indent < listContext.indent)) listContext = null;
      if (marker) {
        // Only known list padding is structural; additional closing indent is at most 3.
        const containerIndent = listContext?.quotes === container.quotes ? listContext.indent : 0;
        fence = { char: marker[1][0], length: marker[1].length, quotes: container.quotes, containerIndent };
        lines.push('代码段已略过。');
      } else lines.push(line);
    }
    text = lines.join('\n')
      .replace(/^ {0,3}#{1,6}\s+/gm, '')
      .replace(/!?\[([^\]\n]*)\]\([^\n)]*\)/g, '$1')
      .replace(/[*_`~]/g, '')
      .replace(/^\s*>\s?/gm, '')
      .trim();
  }
  if (!text.trim()) throw new SpeechInputError('empty-text');
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + 240, text.length);
    if (end < text.length) {
      if (/[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
      for (let cursor = end - 1; cursor >= offset; cursor--) {
        if (/[。！？.!?\n]/.test(text[cursor])) { end = cursor + 1; break; }
      }
    }
    chunks.push(text.slice(offset, end)); offset = end;
  }
  return { text, chunks };
}

function canonicalLanguage(language: string): string {
  try { return Intl.getCanonicalLocales(language)[0] ?? language; } catch { return language; }
}
function compareIdentity(a: BrowserVoice, b: BrowserVoice): number { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }
export function resolveBrowserVoice(voices: readonly BrowserVoice[], preferences: BrowserSpeechPreferences): { voice: BrowserVoice | null; fallback: VoiceFallback } {
  if (preferences.voiceId !== null) return { voice: voices.find(v => v.id === preferences.voiceId) ?? null, fallback: 'none' };
  const language = canonicalLanguage(preferences.language).toLowerCase();
  const exact = voices.filter(v => canonicalLanguage(v.lang).toLowerCase() === language);
  const family = voices.filter(v => v.lang.toLowerCase().split('-')[0] === language.split('-')[0]);
  const candidates = exact.length ? exact : family;
  const priority = (v: BrowserVoice) => v.service === 'local' ? 0 : 1;
  const voice = [...candidates].sort((a, b) => priority(a) - priority(b) || Number(b.isDefault) - Number(a.isDefault) || compareIdentity(a, b))[0] ?? null;
  return { voice, fallback: exact.length ? 'none' : family.length ? 'language-family' : 'browser-default' };
}

const notices: Readonly<Record<string, string>> = {
  unsupported: '当前浏览器没有可用的朗读接口。',
  'invalid-request': '朗读参数无效，请重新选择内容。', 'text-too-long': '文字超过 100,000 字符，请缩短后朗读。',
  'empty-text': '没有可朗读的文字。', 'voices-failed': '无法取得声音列表，请手动刷新后重试。',
  'voice-unavailable': '所选声音已不可用，请重新选择。', 'voice-changed': '声音或来源已变化，请确认后再次点击朗读。',
  'language-unavailable': '该语言不可用，请选择其他声音。', 'cancel-failed': '浏览器未能停止朗读，请再次点击停止或重试。',
  'start-timeout': '浏览器没有报告开始朗读，请再次点击或换一个声音。',
  'completion-timeout': '这段朗读未正常结束，请分成较短内容或重试。',
  'not-allowed': '浏览器未允许朗读，请主动再次点击。', network: '该声音可能需要联网，请检查网络或选择本地声音。',
  'audio-busy': '音频输出正忙，请检查输出后重试。', 'audio-hardware': '音频输出不可用，请检查输出设备。',
  canceled: '朗读意外取消，请再次点击。', interrupted: '朗读意外中断，请再次点击。',
  paused: '浏览器仍暂停朗读，请再次点击或重新打开页面。', hidden: '页面隐藏时无法开始朗读。',
  'environment-failed': '浏览器朗读环境不可用，请重新打开页面。',
  'synthesis-unavailable': '浏览器合成服务不可用，请换声音后重试。', 'synthesis-failed': '浏览器朗读失败，请换声音后重试。',
  'speech-failed': '浏览器朗读失败，请换声音后重试。',
};
const speechErrors = new Set(['canceled', 'interrupted', 'audio-busy', 'audio-hardware', 'network', 'synthesis-unavailable', 'synthesis-failed', 'language-unavailable', 'voice-unavailable', 'text-too-long', 'invalid-argument', 'not-allowed']);
const owners = new WeakMap<object, { token: object; retire: () => void }>();

function defaultEnvironment(): BrowserSpeechEnvironment {
  // Access globals only when a caller explicitly creates a service.
  if (typeof window === 'undefined') return {};
  try {
    return {
      synth: window.speechSynthesis,
      createUtterance: typeof window.SpeechSynthesisUtterance === 'function' ? text => new window.SpeechSynthesisUtterance(text) : undefined,
      window, document: window.document,
      setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: handle => window.clearTimeout(handle as number),
    };
  } catch { return {}; }
}

export function createBrowserReader(environment: BrowserSpeechEnvironment = defaultEnvironment()): BrowserReader {
  const synth = environment.synth;
  let supported = false;
  try {
    supported = !!synth && typeof environment.createUtterance === 'function'
      && ['speak', 'cancel', 'getVoices', 'addEventListener', 'removeEventListener'].every(key => typeof synth[key as keyof typeof synth] === 'function');
  } catch { /* Partial or throwing APIs are unsupported. */ }
  const token = {};
  let disposed = false;
  let disposing = false;
  let environmentFailed = false;
  let generation = 0;
  let current: SpeechSynthesisUtterance | null = null;
  let currentTimer: unknown;
  let voiceTimer: unknown;
  let chunks: string[] = [];
  let index = 0;
  let runtimeVoices = new Map<string, SpeechSynthesisVoice>();
  const listeners = new Set<() => void>();
  const cleanup: (() => void)[] = [];
  const schedule = environment.setTimeout ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms));
  const unschedule = environment.clearTimeout ?? (handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
  const state: BrowserSpeechSnapshot = {
    supported, voicePhase: supported ? 'loading' : 'failed', voices: [], phase: 'idle', active: null,
    effectiveVoice: null, requestedLanguage: null, fallback: null,
    notice: supported ? '正在取得浏览器声音列表。' : notices.unsupported, errorCode: supported ? null : 'unsupported',
  };
  const hasOwnership = () => !!synth && owners.get(synth)?.token === token;
  const owns = () => !disposed && !disposing && hasOwnership();
  function emit() { for (const listener of [...listeners]) { try { listener(); } catch { /* A subscriber cannot break cancellation. */ } } }
  function clearTimer(kind: 'current' | 'voice') {
    const handle = kind === 'current' ? currentTimer : voiceTimer;
    if (kind === 'current') currentTimer = undefined; else voiceTimer = undefined;
    if (handle !== undefined) { try { unschedule(handle); } catch { /* Current/voice callbacks also check their lifecycle and start state. */ } }
  }
  function detach() {
    if (current) { try { current.onstart = null; current.onend = null; current.onerror = null; } catch { /* Guards below remain authoritative. */ } }
    current = null;
  }
  function invalidate() {
    generation++; clearTimer('current'); detach(); state.active = null; chunks = [];
  }
  function showError(code: string) {
    state.phase = 'error'; state.active = null; state.errorCode = code; state.notice = notices[code] ?? notices['speech-failed']; emit();
  }
  function cancelOutput(): boolean {
    if (disposed || !hasOwnership() || !supported) return true;
    try { synth!.cancel!(); return true; } catch { showError('cancel-failed'); return false; }
  }
  function fail(code: string) { invalidate(); if (cancelOutput()) showError(code); }
  function stop(_reason: 'user' | 'scope' | 'hidden' | 'restore' | 'update' = 'user') {
    if (!owns()) return;
    invalidate(); state.phase = 'stopped'; state.errorCode = null; state.notice = '朗读已停止。';
    if (cancelOutput()) emit();
  }
  function refreshVoices() {
    if (!owns() || !supported || environmentFailed) return;
    try {
      const nextRuntime = new Map<string, SpeechSynthesisVoice>();
      const voices: BrowserVoice[] = [];
      for (const voice of synth!.getVoices!()) {
        const lang = voice.lang;
        const service: VoiceService = voice.localService === true ? 'local' : voice.localService === false ? 'remote' : 'unknown';
        const id = JSON.stringify([voice.voiceURI, voice.name, canonicalLanguage(lang), service]);
        if (nextRuntime.has(id)) continue;
        nextRuntime.set(id, voice);
        voices.push({ id, voiceURI: voice.voiceURI, name: voice.name, lang, service, isDefault: voice.default === true });
      }
      voices.sort((a, b) => a.lang < b.lang ? -1 : a.lang > b.lang ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : compareIdentity(a, b));
      runtimeVoices = nextRuntime; state.voices = voices;
      if (voices.length) {
        clearTimer('voice'); state.voicePhase = 'ready';
        if (!state.active && state.errorCode === 'voices-failed') { state.errorCode = null; state.notice = '浏览器声音列表已更新。'; }
      }
      else if (state.voicePhase !== 'loading') { clearTimer('voice'); state.voicePhase = 'empty'; }
      else if (voiceTimer === undefined) voiceTimer = schedule(() => {
        voiceTimer = undefined;
        if (!owns() || state.voices.length || state.voicePhase !== 'loading') return;
        state.voicePhase = 'empty'; if (!state.active) state.notice = '尚未取得声音列表，浏览器默认声音来源未知。'; emit();
      }, 3000);
      emit();
    } catch {
      clearTimer('voice'); runtimeVoices = new Map(); state.voices = []; state.voicePhase = 'failed';
      if (!state.active) { state.errorCode = 'voices-failed'; state.notice = notices['voices-failed']; } emit();
    }
  }
  function selectVoice(saved: BrowserReadRequest, expectedGeneration: number): boolean {
    refreshVoices();
    if (!owns() || generation !== expectedGeneration) return false;
    if (state.voicePhase === 'failed') { fail('voices-failed'); return false; }
    const choice = resolveBrowserVoice(state.voices, saved.preferences);
    state.effectiveVoice = choice.voice; state.requestedLanguage = saved.preferences.language; state.fallback = choice.fallback;
    if (saved.preferences.voiceId !== null && !choice.voice) { fail('voice-unavailable'); return false; }
    if ((choice.voice?.id ?? null) !== saved.expectedVoice.id || (choice.voice?.service ?? 'unknown') !== saved.expectedVoice.service) {
      fail('voice-changed'); return false;
    }
    return true;
  }
  function submit(saved: BrowserReadRequest, expectedGeneration: number) {
    if (!owns() || generation !== expectedGeneration) return;
    if (!selectVoice(saved, expectedGeneration) || generation !== expectedGeneration) return;
    let utterance: SpeechSynthesisUtterance;
    try {
      utterance = environment.createUtterance!(chunks[index]);
      utterance.text = chunks[index]; utterance.lang = state.effectiveVoice?.lang ?? saved.preferences.language;
      utterance.voice = state.effectiveVoice ? runtimeVoices.get(state.effectiveVoice.id)! : null;
      utterance.rate = saved.preferences.rate; utterance.pitch = 1; utterance.volume = 1;
      current = utterance;
      const isCurrent = () => owns() && generation === expectedGeneration && current === utterance;
      let started = false;
      utterance.onstart = () => {
        if (!isCurrent() || started) return;
        started = true; clearTimer('current'); state.phase = 'speaking'; state.notice = '正在朗读。';
        try { currentTimer = schedule(() => { if (isCurrent()) fail('completion-timeout'); }, 120_000); }
        catch { fail('environment-failed'); return; }
        emit();
      };
      utterance.onend = () => {
        if (!isCurrent()) return;
        clearTimer('current'); detach(); index++;
        if (index < chunks.length) submit(saved, expectedGeneration);
        else { invalidate(); state.phase = 'completed'; state.errorCode = null; state.notice = '浏览器已报告朗读完成。'; emit(); }
      };
      utterance.onerror = event => {
        if (!isCurrent()) return;
        const code = speechErrors.has(event.error) ? event.error : 'speech-failed'; fail(code);
      };
      state.phase = 'starting'; state.errorCode = null; state.notice = '正在启动朗读。';
      state.active = { scope: saved.scope, itemId: saved.itemId, chunk: index + 1, chunks: chunks.length };
      currentTimer = schedule(() => { if (isCurrent() && !started) fail('start-timeout'); }, 10_000);
      emit();
      if (isCurrent()) synth!.speak!(utterance);
    } catch { if (owns() && generation === expectedGeneration) fail('speech-failed'); }
  }
  function validRequest(value: BrowserReadRequest): boolean {
    return !!value && typeof value.scope === 'string' && !!value.scope && typeof value.itemId === 'string' && !!value.itemId
      && !!value.preferences && (value.preferences.voiceId === null || typeof value.preferences.voiceId === 'string')
      && ['zh-CN', 'en-US'].includes(value.preferences.language) && [0.75, 1, 1.25, 1.5].includes(value.preferences.rate)
      && !!value.expectedVoice && (value.expectedVoice.id === null || typeof value.expectedVoice.id === 'string')
      && ['local', 'remote', 'unknown'].includes(value.expectedVoice.service);
  }
  function read(value: BrowserReadRequest) {
    if (disposed || disposing) return;
    if (!supported) { showError('unsupported'); return; }
    if (!owns()) return;
    invalidate();
    if (!cancelOutput()) return;
    if (environmentFailed) { showError('environment-failed'); return; }
    try {
      if (environment.document?.hidden) { showError('hidden'); return; }
      if (!validRequest(value)) { showError('invalid-request'); return; }
      const prepared = prepareBrowserSpeech(value.text, value.format);
      if (synth!.paused) { synth!.resume?.(); if (synth!.paused) { showError('paused'); return; } }
      const saved = { ...value, preferences: { ...value.preferences }, expectedVoice: { ...value.expectedVoice } };
      chunks = prepared.chunks; index = 0;
      submit(saved, generation);
    } catch (error) { fail(error instanceof SpeechInputError ? error.code : 'speech-failed'); }
  }
  function disconnect() {
    clearTimer('voice');
    for (const remove of cleanup.splice(0)) { try { remove(); } catch { /* All callbacks also check ownership. */ } }
  }
  function dispose() {
    if (disposed || disposing) return;
    const wasOwner = owns();
    // Seal commands before final cancel/notifications, while retaining cancel authority.
    disposing = true;
    invalidate();
    if (wasOwner) {
      state.phase = 'stopped'; state.errorCode = null; state.notice = '朗读已停止。';
      if (cancelOutput()) emit();
      if (hasOwnership()) owners.delete(synth!);
    }
    disposed = true; disconnect(); listeners.clear();
  }
  function listen(target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>, name: string, callback: EventListener) {
    // Register cleanup first: addEventListener may attach and then throw in an embedder.
    cleanup.push(() => target.removeEventListener(name, callback)); target.addEventListener(name, callback);
  }
  if (supported) {
    owners.get(synth!)?.retire();
    owners.set(synth!, { token, retire: dispose });
    try {
      listen(synth as SpeechSynthesis, 'voiceschanged', refreshVoices);
      if (environment.document) listen(environment.document, 'visibilitychange', () => {
        if (!owns()) return;
        try { if (environment.document!.hidden) stop('hidden'); } catch { fail('environment-failed'); }
      });
      if (environment.window) listen(environment.window, 'pagehide', () => { if (owns()) stop('hidden'); });
      refreshVoices();
    } catch { environmentFailed = true; disconnect(); fail('environment-failed'); }
  }
  return {
    snapshot: () => ({ ...state, voices: state.voices.map(v => ({ ...v })), active: state.active ? { ...state.active } : null, effectiveVoice: state.effectiveVoice ? { ...state.effectiveVoice } : null }),
    subscribe(listener) { if (disposed || disposing) return () => {}; listeners.add(listener); return () => { listeners.delete(listener); }; },
    refreshVoices, read, stop, dispose,
  };
}
