import React, {createContext, useContext, useEffect, useRef, useState} from 'react';
import {Icon} from '../renderer/icon';
import {createBrowserReader, resolveBrowserVoice, type BrowserReadRequest, type BrowserSpeechPreferences, type BrowserSpeechSnapshot, type SpeechRate} from './speech';

const defaults = (): BrowserSpeechPreferences => ({voiceId: null, language: 'zh-CN', rate: 1});
const serviceLabels = {local: '本地', remote: '远程', unknown: '来源未知'};
type ReadingInput = Pick<BrowserReadRequest, 'scope' | 'itemId' | 'text' | 'format'>;
type Reading = ReturnType<typeof useBrowserReading>;
const ReadingContext = createContext<Reading | null>(null);
export const BrowserReadingProvider = ReadingContext.Provider;

/** The App owns one output service; session choices never enter its document. */
export function useBrowserReading(allowed: (scope?: string) => boolean, isCurrent: (request: ReadingInput) => boolean = () => true) {
  const [reader] = useState(() => createBrowserReader());
  const [snapshot, setSnapshot] = useState<BrowserSpeechSnapshot>(() => reader.snapshot());
  const [preferences, setPreferences] = useState(defaults);
  const guard = useRef(allowed); guard.current = allowed;
  const currentGuard = useRef(isCurrent); currentGuard.current = isCurrent;
  const request = useRef<ReadingInput | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    const update = () => setSnapshot(reader.snapshot());
    const unsubscribe = reader.subscribe(update); update();
    return () => {live.current = false; request.current = null; unsubscribe(); reader.dispose();};
  }, [reader]);
  const permitted = (scope?: string) => live.current && guard.current(scope);
  const stop = (reason: Parameters<typeof reader.stop>[0] = 'user') => {request.current = null; reader.stop(reason);};
  return {
    snapshot, preferences,
    read(input: ReadingInput, displayed: BrowserSpeechPreferences, expectedVoice: BrowserReadRequest['expectedVoice']) {
      if (permitted(input.scope) && currentGuard.current(input)) {
        request.current = {...input};
        reader.read({...input, preferences: displayed, expectedVoice});
      }
    },
    change(next: BrowserSpeechPreferences) {if (permitted()) {stop('scope'); setPreferences(next);}},
    refresh() {if (permitted()) reader.refreshVoices();},
    stop,
    invalidate() {
      const active = request.current;
      if (reader.snapshot().active && active && (!permitted(active.scope) || !currentGuard.current(active))) stop('scope');
    },
    reset() {setPreferences(defaults());},
    permitted,
  };
}
function choice(reading: Reading) {
  const resolved = resolveBrowserVoice(reading.snapshot.voices, reading.preferences);
  const missing = reading.preferences.voiceId !== null && !resolved.voice;
  const label = missing ? '所选声音已不可用，请重新选择。' : resolved.voice
    ? `${resolved.voice.name} · ${resolved.voice.lang} · ${serviceLabels[resolved.voice.service]}`
    : '浏览器默认声音 · 来源未知';
  const fallback = resolved.fallback === 'language-family' ? '语言回退到同语系。' : resolved.fallback === 'browser-default' ? '未匹配语言，使用浏览器默认声音。' : '';
  return {label, missing, fallback, network: !missing && resolved.voice?.service !== 'local', expected: {id: resolved.voice?.id ?? null, service: resolved.voice?.service ?? 'unknown'} as BrowserReadRequest['expectedVoice']};
}
function useReading() {return useContext(ReadingContext);}

export function BrowserReadingControls({suspended = false}: {suspended?: boolean}) {
  const reading = useReading();
  if (!reading) return null;
  const displayed = choice(reading);
  const {snapshot, preferences} = reading;
  const previewText = preferences.language === 'zh-CN' ? '这是手动朗读试听。' : 'This is a manual reading preview.';
  const active = snapshot.phase === 'starting' || snapshot.phase === 'speaking';
  const phase = snapshot.phase === 'speaking' ? '浏览器已报告开始朗读。' : snapshot.notice;
  return <section className="browser-page browser-reading" aria-label="手动朗读">
    <h2>手动朗读</h2><p className="browser-muted">仅朗读当前显示的文字。偏好只用于本次网页会话，阅读不计为学习证据。</p>
    <div className="browser-reading-fields">
      <label>声音<select aria-label="朗读声音" disabled={suspended || !snapshot.supported} value={preferences.voiceId ?? ''} onChange={event => reading.change({...preferences, voiceId: event.target.value || null})}>
        <option value="">自动选择（优先同语言本地声音）</option>{preferences.voiceId !== null && !snapshot.voices.some(voice => voice.id === preferences.voiceId) && <option value={preferences.voiceId}>所选声音已不可用</option>}
        {snapshot.voices.map(voice => <option key={voice.id} value={voice.id}>{voice.name} · {voice.lang} · {serviceLabels[voice.service]}</option>)}
      </select></label>
      <label>语言<select aria-label="朗读语言" disabled={suspended || !snapshot.supported} value={preferences.language} onChange={event => {if (event.target.value === 'zh-CN' || event.target.value === 'en-US') reading.change({...preferences, language: event.target.value});}}><option value="zh-CN">中文</option><option value="en-US">英语</option></select></label>
      <label>语速<select aria-label="朗读语速" disabled={suspended || !snapshot.supported} value={preferences.rate} onChange={event => {const rate = Number(event.target.value); if ([0.75, 1, 1.25, 1.5].includes(rate)) reading.change({...preferences, rate: rate as SpeechRate});}}>{[0.75, 1, 1.25, 1.5].map(rate => <option key={rate} value={rate}>{rate}×</option>)}</select></label>
    </div>
    <p className="browser-reading-choice">本次声音：{displayed.label}。{displayed.fallback}{displayed.network && '远程或来源未知的声音可能通过浏览器联网。'}</p>
    <p className="browser-muted">试听文本：{previewText}</p>
    <div className="browser-actions"><button disabled={suspended || !snapshot.supported || displayed.missing} onClick={() => reading.read({scope: 'preview', itemId: 'voice-preview', text: previewText, format: 'plain'}, preferences, displayed.expected)}><Icon name="play"/>试听声音</button><button disabled={suspended || !snapshot.supported} onClick={() => reading.refresh()}>刷新声音列表</button><button disabled={!active && snapshot.errorCode !== 'cancel-failed'} onClick={() => reading.stop()}><Icon name="debug-stop"/>停止朗读</button></div>
    <p role="status" aria-live="polite">{phase}{snapshot.active && ` 第 ${snapshot.active.chunk} / ${snapshot.active.chunks} 段。`}</p>
    {snapshot.voicePhase === 'loading' && <p className="browser-muted">声音列表正在加载；可手动试听浏览器默认声音，来源未知。</p>}
    {snapshot.voicePhase === 'empty' && <p className="browser-muted">声音列表为空；可手动刷新或试听浏览器默认声音，来源未知。</p>}
  </section>;
}

/** Refuse retained handlers for hidden, collapsed, replaced or inactive text. */
export function ReadButton({scope, itemId, text, label, source, eligible = () => true}: {scope: string; itemId: string; text: string; label: string; source: string; eligible?: () => boolean}) {
  const reading = useReading();
  const node = useRef<HTMLDivElement>(null);
  const current = useRef({scope, itemId, text, eligible}); current.current = {scope, itemId, text, eligible};
  if (!reading) return null;
  const displayed = choice(reading);
  const visible = () => {
    if (!node.current?.isConnected || current.current.scope !== scope || current.current.itemId !== itemId || current.current.text !== text || !current.current.eligible()) return false;
    for (let parent: HTMLElement | null = node.current; parent; parent = parent.parentElement) {
      if (parent.hidden || parent instanceof HTMLDetailsElement && !parent.open) return false;
    }
    return reading.permitted(scope);
  };
  return <div className="browser-read-button" ref={node}><p className="browser-muted">{source} · 按显示原文朗读，包含代码。声音：{displayed.label}。{displayed.fallback}{displayed.network && '可能通过浏览器联网。'}</p><button disabled={!reading.snapshot.supported || displayed.missing || !reading.permitted(scope)} onClick={() => {if (visible()) reading.read({scope, itemId, text, format: 'plain'}, reading.preferences, displayed.expected);}}><Icon name="play"/>{label}</button></div>;
}
