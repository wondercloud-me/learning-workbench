import React, {useEffect, useRef, useState} from 'react';
import {VOICE_RESOURCES} from './manifest';
import type {BrowserVoiceCoordinator} from './coordinator';
import type {VoiceDraftPort, VoiceDraftTarget} from './types';

function visible(node: HTMLElement | null): boolean {
  if (!node?.isConnected) return false;
  for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement) {
    if (parent.hidden || parent.hasAttribute('inert') || parent instanceof HTMLDetailsElement && !parent.open) return false;
  }
  return true;
}
function useVoice(voice: BrowserVoiceCoordinator) {
  const [,render] = useState(0); useEffect(()=>voice.subscribe(()=>render(value=>value+1)),[voice]);
  return voice.snapshot();
}
export function BrowserVoiceInput({voice,target,composing,eligible}:{voice:BrowserVoiceCoordinator;target:Omit<VoiceDraftTarget,'scopeVersion'>;composing():boolean;eligible():boolean}) {
  const node = useRef<HTMLDivElement>(null);
  const latest = useRef({target,composing,eligible}); latest.current = {target,composing,eligible};
  const state = useVoice(voice);
  const [port] = useState<VoiceDraftPort>(()=>({
    target:()=>({...latest.current.target,scopeVersion:voice.version()}),
    current:expected=>visible(node.current) && latest.current.eligible() && expected.scopeVersion === voice.version() && Object.keys(latest.current.target).every(key=>expected[key as keyof VoiceDraftTarget] === latest.current.target[key as keyof typeof target]),
    composing:()=>latest.current.composing(),
  }));
  useEffect(()=>()=>voice.release(port),[voice,port]);
  const expected = {...target,scopeVersion:voice.version()};
  const current = () => port.current(expected);
  const owned = state.service?.preview?.target.columnId === target.columnId && state.service.preview.target.key === target.key && state.service.preview.target.scopeVersion === expected.scopeVersion;
  const phase = state.service?.phase ?? 'idle';
  const recording = ['preparing','permission','recording','flushing','recognizing'].includes(phase);
  const preview = owned ? state.service?.preview : null;
  const cleanupFailed = ['audio-cleanup','worker-cleanup'].includes(state.service?.errorCode ?? '');
  return <div className="browser-voice-input" aria-label="本地语音输入" ref={node}>
    <p>可选实验：语音在本机处理，每次最多 30 秒。检查文字后手动追加到当前草稿。</p>
    {!state.ready && !state.operation && <p>先在“设置 → 可选本地语音”检查并下载资源；也可继续键盘输入。</p>}
    {!recording && !preview && <button disabled={!state.ready || !!state.operation || cleanupFailed} onClick={()=>{if(current())voice.start(port,expected);}}>开始本地录音</button>}
    {recording && <><p role="status">{({preparing:'正在准备本地语音…',permission:'等待麦克风许可…',recording:'正在录音，最长 30 秒。',flushing:'正在收尾…',recognizing:'正在本机转写…'} as Record<string,string>)[phase]}</p>{phase==='recording'&&<button onClick={()=>{if(current())voice.stop(port);}}>停止并转写</button>}<button onClick={()=>{if(current())voice.cancel();}}>取消本次语音</button></>}
    {preview && <div className="browser-voice-preview"><h3>检查追加后的草稿</h3><pre>{preview.baseText}{preview.baseText?'\n':''}{preview.transcript}</pre><button onClick={()=>{if(current())voice.repreview(port,expected);}}>重新预览追加</button><button onClick={()=>{if(current())voice.append(port,expected,preview);}}>确认追加到草稿</button><button onClick={()=>{if(current())voice.cancel();}}>取消本次语音</button></div>}
    {(cleanupFailed || state.error) && <p role="alert">{cleanupFailed?'语音资源未能停止，请重新加载页面后再使用或朗读。':state.error}</p>}
    {state.service?.errorCode && !cleanupFailed && !state.error && <p role="alert">本次语音未完成。请继续键盘输入，或检查资源后重试。</p>}
    {state.notice && <p role="status">{state.notice}</p>}
  </div>;
}
export function BrowserVoiceResources({voice}:{voice:BrowserVoiceCoordinator}) {
  const node = useRef<HTMLElement>(null), latest = useRef(voice); latest.current = voice;
  const state = useVoice(voice), busy = !!state.operation;
  const version = voice.version();
  const current = () => latest.current === voice && visible(node.current) && version === voice.version() && voice.resourceAllowed();
  const total = state.manifest?.files.reduce((sum,file)=>sum+file.bytes,0);
  return <section className="browser-card" aria-label="本地语音下载" ref={node}><h2>可选本地语音（实验）</h2><p>单独下载后在本机转写。录音和识别结果不会自动发送或作为学习证据保存。键盘输入始终可用。</p>
    <button disabled={busy} onClick={()=>{if(current())void voice.check();}}>检查本地语音资源</button>
    {state.manifest && <><p>{VOICE_RESOURCES.model.name} · 共 {total!.toLocaleString('en-US')} 字节（约 {(total! / 1024 ** 2).toFixed(1)} MiB）</p><p>{state.manifest.files.filter(file=>file.role==='model'||file.role==='tokens').map(file=>`${file.role==='model'?'模型':'词表'} ${file.bytes.toLocaleString('en-US')} 字节`).join(' · ')}。总量还包含运行引擎。</p><p>识别需要较多内存：运行时初始申请 512 MiB，此外还有模型等开销。手机兼容性仍待实测，可继续键盘输入。</p><p><a href={VOICE_RESOURCES.model.source} target="_blank" rel="noopener noreferrer">模型来源</a> · <a href={VOICE_RESOURCES.model.license.source} target="_blank" rel="noopener noreferrer">{VOICE_RESOURCES.model.license.name}</a>；运行引擎许可 <a href={VOICE_RESOURCES.runtime.license.source} target="_blank" rel="noopener noreferrer">Apache-2.0</a>。</p><p>{state.ready?'本地下载已校验。':'尚未检查到可用的本地下载。'}</p><div className="browser-actions"><button disabled={busy} onClick={()=>{if(current())void voice.download();}}>下载模型到本机</button><button disabled={busy} onClick={()=>{if(current())void voice.verify();}}>检查已有模型缓存</button><button disabled={busy} onClick={()=>{if(current())void voice.delete();}}>删除本地语音下载</button></div></>}
    {busy && <><p role="status">{state.operation==='downloading'?'正在下载并校验…':state.operation==='checking'?'正在检查资源…':state.operation==='deleting'?'正在删除可选下载…':'正在重新校验缓存…'}{state.progress&&` ${state.progress.receivedBytes.toLocaleString('en-US')} / ${state.progress.totalBytes.toLocaleString('en-US')} 字节`}</p><button onClick={()=>void voice.cancelResources()}>取消语音下载</button></>}
    {state.error&&<p role="alert">{state.error}</p>}{state.notice&&<p role="status">{state.notice}</p>}
  </section>;
}
