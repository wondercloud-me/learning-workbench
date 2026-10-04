import React, { useEffect, useRef, useState } from 'react';
import { encodeWav, MAX_SECONDS, SAMPLE_RATE, type VoiceSettings } from '../core/speech';
import { Icon } from './shell';
import type { Message } from '../core/learning';

let captureOwner: string | null = null;

async function recordingToWav(blob: Blob): Promise<ArrayBuffer> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (!decoded.length) throw new Error('没有录到声音，请重试');
    const frameCount = Math.min(Math.ceil(decoded.duration * SAMPLE_RATE), MAX_SECONDS * SAMPLE_RATE);
    const output = new OfflineAudioContext(1, frameCount, SAMPLE_RATE);
    const source = output.createBufferSource(); source.buffer = decoded; source.connect(output.destination); source.start();
    const samples = (await output.startRendering()).getChannelData(0);
    const energy = samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length;
    if (energy < 0.0000001) throw new Error('没有录到清晰声音，请靠近麦克风重试');
    return encodeWav(samples);
  } finally { await context.close(); }
}

export function VoiceInput({ disabled, onText, onError, onActive, stopReading }: {
  disabled: boolean; onText: (text: string) => void; onError: (error: string) => void;
  onActive: (active: boolean) => void; stopReading: () => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'permission' | 'recording' | 'processing'>('idle');
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null);
  const token = useRef<string | null>(null), timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const callbacks = useRef({ onText, onError, onActive, stopReading });
  callbacks.current = { onText, onError, onActive, stopReading };
  const clearMedia = () => { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; if (timer.current) clearInterval(timer.current); timer.current = null; };
  const release = (id: string) => { if (token.current !== id) return; token.current = null; if (captureOwner === id) captureOwner = null; clearMedia(); callbacks.current.onActive(false); setPhase('idle'); };
  const cancel = (update = true) => {
    const id = token.current; token.current = null;
    if (id) { void window.workbench.cancelTranscription(id).catch(() => {}); if (captureOwner === id) captureOwner = null; callbacks.current.onActive(false); }
    if (recorder.current?.state === 'recording') recorder.current.stop();
    recorder.current = null; clearMedia(); if (update) setPhase('idle');
  };
  const finish = () => {
    if (recorder.current?.state !== 'recording') return;
    setPhase('processing'); recorder.current.stop();
  };
  useEffect(() => {
    const hidden = () => { if (document.hidden) cancel(); };
    document.addEventListener('visibilitychange', hidden);
    return () => { document.removeEventListener('visibilitychange', hidden); cancel(false); };
  }, []);

  async function start() {
    if (disabled || captureOwner) return;
    const id = crypto.randomUUID(); token.current = id; captureOwner = id;
    callbacks.current.stopReading(); callbacks.current.onActive(true); setPhase('permission'); setSeconds(0);
    try {
      if (!await window.workbench.microphoneAccess()) throw new Error('麦克风权限未开启，请到系统设置 → 隐私与安全性 → 麦克风，允许学习工作台');
      if (token.current !== id) return;
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (token.current !== id) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      const active = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      const parts: Blob[] = [];
      active.ondataavailable = event => { if (event.data.size) parts.push(event.data); };
      active.onerror = () => { if (token.current === id) { callbacks.current.onError('录音中断，请检查麦克风后重试'); cancel(); } };
      active.onstop = async () => {
        if (token.current !== id) return;
        clearMedia(); recorder.current = null;
        setPhase('processing');
        try {
          const wav = await recordingToWav(new Blob(parts, { type: active.mimeType }));
          if (token.current !== id) return;
          const text = await window.workbench.transcribe(id, wav);
          if (token.current === id) callbacks.current.onText(text);
        } catch (error) { if (token.current === id) callbacks.current.onError(error instanceof Error ? error.message : String(error)); }
        finally { release(id); }
      };
      recorder.current = active; active.start(250); setPhase('recording');
      const began = Date.now();
      timer.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - began) / 1000); setSeconds(elapsed);
        if (elapsed >= MAX_SECONDS && active.state === 'recording') finish();
      }, 250);
    } catch (error) {
      if (token.current !== id) return;
      const failure = error as Error;
      callbacks.current.onError(failure.name === 'NotAllowedError' ? '请在系统设置中允许学习工作台使用麦克风，然后重试' : failure.name === 'NotFoundError' ? '没有找到麦克风，请连接麦克风后重试' : failure.message);
      release(id);
    }
  }
  return <div className={`voice-input ${phase === 'recording' ? 'recording' : ''}`}>
    <button type="button" disabled={phase === 'idle' && disabled || phase === 'permission' || phase === 'processing'} aria-label={phase === 'recording' ? '结束录音并识别' : '开始语音输入'} onClick={() => phase === 'recording' ? finish() : void start()}>
      {phase === 'recording' ? <><Icon name="debug-stop"/>{`结束录音 ${seconds}s`}</> : phase === 'processing' ? '本机识别中…' : phase === 'permission' ? '正在打开麦克风…' : <><Icon name="mic"/>语音输入</>}
    </button>
    {phase !== 'idle' && <button type="button" aria-label="取消语音输入" onClick={() => cancel()}>取消</button>}
    <span role="status">{phase === 'recording' ? '最多 60 秒 · 结束后填入草稿' : phase === 'idle' ? '本机识别 · 不上传录音' : ''}</span>
  </div>;
}

export function useReadAloud(settings: VoiceSettings, context: string, messages: Message[], onError: (text: string) => void) {
  const [speaking, setSpeaking] = useState<string | null>(null);
  const generation = useRef(0);
  const latest = useRef({ context, id: messages.at(-1)?.id });
  function stop() { generation.current++; setSpeaking(null); void window.workbench.stopSpeaking().catch(() => {}); }
  async function read(id: string, text: string) {
    if (speaking === id) { stop(); return; }
    const turn = ++generation.current; setSpeaking(id);
    try { await window.workbench.speak(text, settings.voice, settings.rate); }
    catch (error) { if (generation.current === turn) onError(error instanceof Error ? error.message : String(error)); }
    finally { if (generation.current === turn) setSpeaking(null); }
  }
  useEffect(() => {
    const last = messages.at(-1);
    if (latest.current.context !== context) { stop(); latest.current = { context, id: last?.id }; return; }
    const changed = last?.id !== latest.current.id;
    latest.current = { context, id: last?.id };
    if (changed && settings.autoRead && last?.role === 'assistant') void read(last.id, last.content);
  }, [context, messages.at(-1)?.id]);
  useEffect(() => { if (!settings.autoRead) stop(); }, [settings.autoRead]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', hidden);
    return () => { document.removeEventListener('visibilitychange', hidden); void window.workbench.stopSpeaking(); };
  }, []);
  return { speaking, read, stop };
}

export function VoiceSettingsPanel({ value, onChange, onError }: { value: VoiceSettings; onChange: (value: VoiceSettings) => void; onError: (text: string) => void }) {
  const [voices, setVoices] = useState<Array<{ name: string; language: string }>>([]);
  const [status, setStatus] = useState('正在检查本机模型…');
  useEffect(() => {
    void window.workbench.listVoices().then(setVoices).catch(error => onError(String(error)));
    void window.workbench.voiceStatus().then(info => setStatus(info.ready ? `${info.model} · 已就绪` : info.reason)).catch(error => setStatus(String(error)));
  }, []);
  return <div className="panel-card voice-settings"><h2>语音输入与朗读</h2><p>{status}</p><p>录音在本机识别，普通话、粤语和英语会自动判断。每次最多 60 秒，文字先放入草稿。录音不进入聊天记录或备份。</p>
    <label><input type="checkbox" checked={value.autoRead} onChange={event => onChange({ ...value, autoRead: event.target.checked })}/>自动朗读新回复</label>
    <label>朗读声音<select value={value.voice} onChange={event => onChange({ ...value, voice: event.target.value })}><option value="">系统中文声音</option>{voices.sort((a, b) => Number(b.language.startsWith('zh')) - Number(a.language.startsWith('zh'))).map(voice => <option key={voice.name} value={voice.name}>{voice.name} · {voice.language}</option>)}</select></label>
    <label>朗读语速<select value={value.rate} onChange={event => onChange({ ...value, rate: Number(event.target.value) })}>{[0.75, 1, 1.25, 1.5].map(rate => <option key={rate} value={rate}>{rate} 倍</option>)}</select></label>
    <div className="button-row"><button onClick={() => void window.workbench.speak('你好，我们一步一步来。先理解，再用自己的话讲出来。', value.voice, value.rate).catch(error => onError(String(error)))}>试听声音</button><button onClick={() => void window.workbench.stopSpeaking()}>停止试听</button></div>
    <small>朗读使用系统声音，代码块会略过。语音模型：SenseVoice Small（FunAudioLLM / FunASR）；运行引擎：sherpa-onnx。</small>
  </div>;
}
