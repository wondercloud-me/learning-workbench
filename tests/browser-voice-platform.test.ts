import {expect, it, vi} from 'vitest';
import {createBrowserVoicePlatform, type BrowserVoiceEnvironment} from '../src/browser/voice/platform';
import {VOICE_RESOURCES, type VoiceManifest} from '../src/browser/voice/manifest';

const base='/learn/';
function manifest():VoiceManifest {
 const path=base+'optional-asr/1.13.8/test/';
 return {schemaVersion:1,buildId:'test',basePath:path,modelKind:'senseVoice',runtimeVersion:'1.13.8',files:[
  ...VOICE_RESOURCES.files.map(file=>({role:file.role,filename:file.filename,url:path+file.filename,downloadUrl:path+file.filename+'?wb-asr-download=1',bytes:file.bytes,sha256:file.sha256})),
  ...(['worker','worklet'] as const).map(role=>({role,filename:role==='worker'?'runtime.worker.js':'capture.worklet.js',url:path+(role==='worker'?'runtime.worker.js':'capture.worklet.js'),downloadUrl:path+(role==='worker'?'runtime.worker.js':'capture.worklet.js')+'?wb-asr-download=1',bytes:1,sha256:'a'.repeat(64)})),
 ] as VoiceManifest['files']};
}
function host() {
 const document=Object.assign(new EventTarget(),{visibilityState:'visible'});
 const window=new EventTarget(); const getUserMedia=vi.fn(); const addModule=vi.fn().mockResolvedValue(undefined);
 const Worker=vi.fn(function(){}),AudioContext=vi.fn(function(){}),AudioWorkletNode=vi.fn(function(){});
 const value={origin:'https://workbench.example',isSecureContext:true,document,window,mediaDevices:{getUserMedia},Worker,AudioContext,AudioWorkletNode,
  performance:{now:()=>12},setTimeout:vi.fn(),clearTimeout:vi.fn()} as unknown as BrowserVoiceEnvironment;
 return {value,document,window,getUserMedia,Worker,AudioContext,AudioWorkletNode,addModule};
}
it('constructs without requesting permission, starting audio, creating a Worker or loading a module',()=>{
 const h=host();const platform=createBrowserVoicePlatform(manifest(),base,()=>true,h.value);
 expect(platform.lifecycle.current()).toBe(true);
 expect(h.getUserMedia).not.toHaveBeenCalled();expect(h.Worker).not.toHaveBeenCalled();expect(h.AudioContext).not.toHaveBeenCalled();expect(h.addModule).not.toHaveBeenCalled();
});
it('uses sealed same-origin classic Worker and external worklet URLs; captures into the silent processor',async()=>{
 const h=host();const raw=manifest();const platform=createBrowserVoicePlatform(raw,base,()=>true,h.value);
 (raw.files[5] as {url:string}).url='https://elsewhere.example/evil.js';
 platform.createWorker();expect(h.Worker).toHaveBeenCalledWith('https://workbench.example/learn/optional-asr/1.13.8/test/runtime.worker.js',{type:'classic',name:'workbench-local-voice'});
 const context={audioWorklet:{addModule:h.addModule}} as unknown as AudioContext;
 await platform.createCaptureNode(context,7);
 expect(h.addModule).toHaveBeenCalledWith('https://workbench.example/learn/optional-asr/1.13.8/test/capture.worklet.js');
 expect(h.AudioWorkletNode).toHaveBeenCalledWith(context,'workbench-voice-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],processorOptions:{captureId:7}});
 expect(h.getUserMedia).not.toHaveBeenCalled();
});
it('refuses unsupported or insecure environments before any optional resource or audio action',()=>{
 for(const patch of [{isSecureContext:false},{Worker:undefined},{AudioContext:undefined},{AudioWorkletNode:undefined},{mediaDevices:undefined}]){
  const h=host();expect(()=>createBrowserVoicePlatform(manifest(),base,()=>true,{...h.value,...patch})).toThrow();
  expect(h.getUserMedia).not.toHaveBeenCalled();expect(h.Worker).not.toHaveBeenCalled();expect(h.AudioContext).not.toHaveBeenCalled();
 }
});
it('invalidates hidden/pagehide state, allows only a fresh action on return, and detaches all listeners',()=>{
 const h=host();let eligible=true;const p=createBrowserVoicePlatform(manifest(),base,()=>eligible,h.value);const change=vi.fn();const detach=p.lifecycle.subscribe(change);
 h.document.visibilityState='hidden';h.document.dispatchEvent(new Event('visibilitychange'));expect(p.lifecycle.current()).toBe(false);
 h.document.visibilityState='visible';h.document.dispatchEvent(new Event('visibilitychange'));expect(p.lifecycle.current()).toBe(true);
 h.window.dispatchEvent(new Event('pagehide'));expect(p.lifecycle.current()).toBe(false);
 h.window.dispatchEvent(new Event('pageshow'));expect(p.lifecycle.current()).toBe(true);
 eligible=false;expect(p.lifecycle.current()).toBe(false);expect(change).toHaveBeenCalledTimes(4);
 detach();detach();h.window.dispatchEvent(new Event('pagehide'));h.document.dispatchEvent(new Event('visibilitychange'));expect(change).toHaveBeenCalledTimes(4);
});
it('rejects an invalid capture id before loading a worklet',async()=>{
 const h=host();const p=createBrowserVoicePlatform(manifest(),base,()=>true,h.value);const context={audioWorklet:{addModule:h.addModule}} as unknown as AudioContext;
 await expect(p.createCaptureNode(context,-1)).rejects.toThrow();expect(h.addModule).not.toHaveBeenCalled();
});
