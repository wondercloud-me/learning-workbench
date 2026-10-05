// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, expect, it, vi} from 'vitest';
import {BrowserApp} from '../src/browser/app';
import {BrowserReadingControls, BrowserReadingProvider, ReadButton, useBrowserReading} from '../src/browser/read-aloud';
import type {BrowserController} from '../src/browser/controller';
import {emptyBrowserDocument, type BrowserDocument, type BrowserSnapshot} from '../src/core/browser-state';
import {createColumn} from '../src/core/learning';
import {createBackup} from '../src/core/backup';
import type {PwaReadiness} from '../src/browser/pwa';
const captured=vi.hoisted(()=>({readiness:null as PwaReadiness|null}));
vi.mock('../src/renderer/lab-client',()=>({executeLab:async()=>{throw Error('No execution in reading test');}}));
vi.mock('../src/browser/pwa',()=>({registerBrowserPwa:async(_base:string,readiness:PwaReadiness)=>{captured.readiness=readiness;return {status:()=>({phase:'not-ready',install:'unsupported',message:'fixture'}),subscribe:()=>()=>{},dispose:()=>{},requestUpdate:async()=>false};}}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const mounted:Array<{root:Root;host:HTMLElement}>=[];
afterEach(async()=>{for(const ui of mounted.splice(0)){await act(async()=>ui.root.unmount());ui.host.remove();}vi.unstubAllGlobals();vi.restoreAllMocks();});
function audio(){
 let voices=[{voiceURI:'local-cn',name:'中文本地',lang:'zh-CN',localService:true,default:true}];
 const events=new EventTarget();const submissions:SpeechSynthesisUtterance[]=[];
 const synth={getVoices:()=>voices,speak:(u:SpeechSynthesisUtterance)=>{submissions.push(u);},cancel:vi.fn(),paused:false,resume:()=>{},addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)};
 vi.stubGlobal('speechSynthesis',synth);vi.stubGlobal('SpeechSynthesisUtterance',class {text:string;constructor(text:string){this.text=text;}});
 return {synth,submissions,setVoices:(value:typeof voices)=>{voices=value;},changed:()=>events.dispatchEvent(new Event('voiceschanged'))};
}
const now='2026-10-05T00:00:00.000Z';
function fixture(){const d=emptyBrowserDocument();d.state.onboarding.introSeen=true;d.state.settings.voice.autoRead=true;d.state.columns=[createColumn('第一栏目','理解函数',now,'c'),createColumn('第二栏目','理解参数',now,'other')];d.state.activeColumnId='c';d.state.columns[0].messages=[{id:'main',role:'assistant',origin:'assistant',content:'第一句。\n```js\nconst x = 1;\n```',createdAt:now}];d.state.columns[1].messages=[{id:'other-message',role:'assistant',content:'隐藏栏目内容',createdAt:now}];d.drafts.references['https://example.com/source']={url:'https://example.com/source',text:'  # 字面原文\n```code```  ',providedAt:now};return d;}
async function mount(initial=fixture()){
 let value=initial;const listeners=new Set<()=>void>();const snapshot=():BrowserSnapshot=>({schemaVersion:1,revision:0,updatedAt:now,document:value});
 const controller:BrowserController={snapshot,pendingDocument:()=>value,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>listeners.delete(fn);},change:async(fn:(d:BrowserDocument)=>BrowserDocument)=>{value=fn(value);listeners.forEach(fn=>fn());return snapshot();},replace:async(d:BrowserDocument)=>{value=d;listeners.forEach(fn=>fn());return snapshot();},reloadLatest:async()=>snapshot(),recoveries:async()=>[],flush:async()=>{},isBusy:()=>false,hasPending:()=>false,storageStatus:()=> 'saved' as const,close:()=>{},acquireUpdateLock:()=>()=>{},documentGeneration:()=>0,messageDraftRevision:()=>0,acquireVoiceOperation:()=>{throw new Error('Voice input is disabled in this legacy UI fixture.');},withOperation:async<T,>(_kind:string,fn:()=>Promise<T>)=>fn()};
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);mounted.push({root,host});await act(async()=>root.render(<BrowserApp controller={controller}/>));
 const button=(label:string)=>{const b=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===label);expect(b,`button ${label}`).toBeTruthy();return b!;};
 const click=async(label:string)=>{await act(async()=>button(label).click());};
 const field=(label:string)=>host.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
 const choose=async(label:string,next:string)=>{const f=field(label);expect(f,`field ${label}`).toBeTruthy();await act(async()=>{Object.getOwnPropertyDescriptor(Object.getPrototypeOf(f),'value')!.set!.call(f,next);f.dispatchEvent(new Event('change',{bubbles:true}));});};
 const publish=(next:BrowserDocument)=>{value=next;listeners.forEach(fn=>fn());};
 return {host,root,controller,button,click,field,choose,publish};
}
function direct(node:HTMLElement,name='onClick'){const key=Object.keys(node).find(k=>k.startsWith('__reactProps$'))!;return (node as any)[key][name];}
function openReading(host:HTMLElement){const details=host.querySelector<HTMLDetailsElement>('.browser-reading details');if(details)details.open=true;}
async function readingHook(beforeRead?:()=>void,allowed:()=>boolean=()=>true,isCurrent:()=>boolean=()=>true){
 let reading!:ReturnType<typeof useBrowserReading>;const host=document.createElement('div');document.body.append(host);const root=createRoot(host);mounted.push({root,host});
 function Harness({before,suspended=false}:{before?:()=>void;suspended?:boolean}){reading=useBrowserReading(allowed,isCurrent,before);return <BrowserReadingProvider value={reading}><BrowserReadingControls suspended={suspended}/><ReadButton scope="message" itemId="message-a" text="消息原文" label="测试消息朗读" source="消息"/><ReadButton scope="reference" itemId="reference-a" text="资料原文" label="测试资料朗读" source="资料"/></BrowserReadingProvider>;}
 const render=async(before?:()=>void,suspended=false)=>{await act(async()=>root.render(<Harness before={before} suspended={suspended}/>));};await render(beforeRead);
 const click=async(label:string)=>{const button=[...host.querySelectorAll<HTMLButtonElement>('button')].find(item=>item.textContent?.trim()===label)!;expect(button).toBeTruthy();await act(async()=>button.click());};
 const read=(held=reading)=>{const voice=held.snapshot.voices[0];held.read({scope:'message',itemId:'message-a',text:'用户原文',format:'plain'},held.preferences,{id:voice?.id??null,service:voice?.service??'unknown'});};
 return {host,render,click,read,current:()=>reading};
}
it('runs the latest beforeRead before preview, message and reference speech including a retained read handler',async()=>{
 const a=audio();const order:string[]=[];const speak=a.synth.speak;a.synth.speak=utterance=>{order.push('speech');speak(utterance);};const ui=await readingHook(()=>order.push('old-before'));
 openReading(ui.host);
 await ui.click('试听声音');await ui.click('测试消息朗读');await ui.click('测试资料朗读');expect(order).toEqual(['old-before','speech','old-before','speech','old-before','speech']);expect(a.submissions.map(item=>item.text)).toEqual(['这是手动朗读试听。','消息原文','资料原文']);
 const retained=ui.current();await ui.render(()=>order.push('latest-before'));await act(async()=>ui.read(retained));expect(order.slice(-2)).toEqual(['latest-before','speech']);
});
it('rechecks both scope and request guards after beforeRead synchronously changes them',async()=>{
 const a=audio();let allowed=true,current=true;const ui=await readingHook(()=>{allowed=false;},()=>allowed,()=>current);await ui.click('测试消息朗读');expect(a.submissions).toHaveLength(0);
 allowed=true;await ui.render(()=>{current=false;});await ui.click('测试消息朗读');expect(a.submissions).toHaveLength(0);
});
it('confirms stopping from the synchronous reader snapshot even while the React snapshot is stale',async()=>{
 const a=audio();const ui=await readingHook();expect(ui.current().stopAndConfirm).toBeTypeOf('function');
 await act(async()=>{const held=ui.current();ui.read(held);expect(held.snapshot.active).toBeNull();expect(held.stopAndConfirm()).toBe(true);});
 await act(async()=>{const held=ui.current();ui.read(held);a.synth.cancel.mockImplementation(()=>{throw Error('injected cancel failure');});expect(held.snapshot.errorCode).toBeNull();expect(held.stopAndConfirm()).toBe(false);});expect(ui.current().snapshot.errorCode).toBe('cancel-failed');
});
it('refuses speech when beforeRead fails and retains the failure across voice-list notifications',async()=>{
 const a=audio();const ui=await readingHook(()=>{throw Error('input cleanup was not confirmed');});await ui.click('测试消息朗读');expect(a.submissions).toHaveLength(0);expect(ui.current().snapshot.errorCode).toBe('before-read-failed');expect(ui.host.textContent).toContain('无法确认语音输入已停止');
 await act(async()=>a.changed());expect(ui.current().snapshot.errorCode).toBe('before-read-failed');a.synth.cancel.mockImplementation(()=>{throw Error('injected output cancellation failure');});await ui.click('测试消息朗读');expect(ui.current().snapshot.errorCode).toBe('cancel-failed');expect(a.submissions).toHaveLength(0);
});
async function teaching(ui:Awaited<ReturnType<typeof mount>>){await ui.click('可选 AI 教学');}
async function backup(ui:Awaited<ReturnType<typeof mount>>,d=fixture()) {const file=new File(['fixture'],'backup.json');Object.defineProperty(file,'text',{value:async()=>JSON.stringify(createBackup(d,'0.9.0',now))});const input=ui.host.querySelector<HTMLInputElement>('[aria-label="选择备份文件"]')!;Object.defineProperty(input,'files',{configurable:true,value:[file]});await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));}
it('unsupported reading preserves all learning features and imported autoRead never starts audio',async()=>{const ui=await mount();await teaching(ui);expect(ui.host.textContent).toContain('当前浏览器没有可用的朗读接口');expect(ui.button('朗读这条消息').disabled).toBe(true);expect(ui.controller.pendingDocument()).toEqual(fixture());});
it('submits first segment synchronously with displayed local choice and plain visible text, without document writes',async()=>{const a=audio();const ui=await mount();openReading(ui.host);const before=structuredClone(ui.controller.pendingDocument());expect(a.submissions).toHaveLength(0);await teaching(ui);expect(ui.host.textContent).toContain('中文本地 · zh-CN · 本地');await act(async()=>{ui.button('朗读这条消息').click();expect(a.submissions).toHaveLength(1);});expect(a.submissions[0].text).toBe(before.state.columns[0].messages[0].content);expect(a.submissions[0].voice?.voiceURI).toBe('local-cn');await act(async()=>a.submissions[0].onstart?.({} as SpeechSynthesisEvent));expect(ui.host.textContent).toContain('浏览器已报告开始');expect(ui.host.textContent).toContain('1 / 1');expect(ui.button('停止朗读').disabled).toBe(false);await ui.choose('朗读语速','1.5');await ui.choose('朗读语言','en-US');await ui.click('试听声音');expect(a.submissions.at(-1)?.rate).toBe(1.5);expect(ui.controller.pendingDocument()).toEqual(before);});
it('rechecks displayed origin and identity before speech; manual refresh and late lists do not play',async()=>{const a=audio();const ui=await mount();openReading(ui.host);await teaching(ui);a.setVoices([{voiceURI:'local-cn',name:'中文本地',lang:'zh-CN',localService:false,default:true}]);await ui.click('朗读这条消息');expect(a.submissions).toHaveLength(0);expect(ui.host.textContent).toContain('声音或来源已变化');expect(ui.host.textContent).toContain('可能通过浏览器联网');await ui.click('刷新声音列表');expect(a.submissions).toHaveLength(0);await ui.click('朗读这条消息');expect(a.submissions).toHaveLength(1);});
it('one owner replaces preview with current message and saved reference exactly; hidden captured handlers are refused',async()=>{const a=audio();const ui=await mount();openReading(ui.host);await ui.click('试听声音');await teaching(ui);const main=direct(ui.button('朗读这条消息'));await ui.click('朗读这条消息');const staleEnd=a.submissions[0].onend;await ui.click('资料');const n=a.submissions.length;await act(async()=>main());expect(a.submissions).toHaveLength(n);const details=ui.button('朗读这份材料').closest('details') as HTMLDetailsElement;details.open=true;await ui.click('朗读这份材料');expect(a.submissions.at(-1)?.text).toBe('  # 字面原文\n```code```  ');await act(async()=>staleEnd?.call(a.submissions[0],{} as SpeechSynthesisEvent));expect(a.submissions).toHaveLength(n+1);expect(a.synth.cancel).toHaveBeenCalled();});
it('stops before navigation and column switching and rejects hidden column handlers without unmounting',async()=>{const a=audio();const ui=await mount();openReading(ui.host);await teaching(ui);const read=direct(ui.button('朗读这条消息'));await ui.click('朗读这条消息');const cancel=a.synth.cancel.mock.calls.length;await ui.choose('当前教学栏目','other');expect(a.synth.cancel.mock.calls.length).toBeGreaterThan(cancel);expect(ui.host.querySelector('[data-teaching-column="c"]')).toBeTruthy();await act(async()=>read());expect(a.submissions).toHaveLength(1);await ui.click('动手实践');await ui.click('记录');expect(a.submissions).toHaveLength(1);});
it('acquiring update lock stops synchronously and captured read/preview/refresh/preference handlers cannot act or replay after unlock',async()=>{const a=audio();const ui=await mount();openReading(ui.host);await teaching(ui);const read=direct(ui.button('朗读这条消息')),preview=direct(ui.button('试听声音')),refresh=direct(ui.button('刷新声音列表')),change=direct(ui.field('朗读语速'),'onChange');await ui.click('朗读这条消息');const cancel=a.synth.cancel.mock.calls.length;let release!:()=>void;await act(async()=>{release=captured.readiness!.acquireUpdateLock();expect(a.synth.cancel.mock.calls.length).toBeGreaterThan(cancel);read();preview();refresh();change({target:{value:'1.5'}});});expect(a.submissions).toHaveLength(1);expect(ui.field('朗读语速').value).toBe('1');await act(async()=>release());expect(a.submissions).toHaveLength(1);});
it('backup preview and cancel preserve session preferences; confirmed replacement stops before write and successful restore resets',async()=>{const a=audio();const ui=await mount();openReading(ui.host);await ui.choose('朗读语速','1.5');await ui.click('设置');await ui.click('试听声音');let cancel=a.synth.cancel.mock.calls.length;await backup(ui);expect(a.synth.cancel.mock.calls.length).toBe(cancel);await ui.click('取消导入');expect(ui.field('朗读语速').value).toBe('1.5');expect(a.synth.cancel.mock.calls.length).toBe(cancel);await backup(ui);const replace=ui.controller.replace;ui.controller.replace=async d=>{expect(a.synth.cancel.mock.calls.length).toBeGreaterThan(cancel);return replace(d);};await ui.click('确认恢复备份');expect(ui.field('朗读语速').value).toBe('1');expect(a.submissions).toHaveLength(1);});
it('failed or blocked replacement preserves preferences; unsaved guard runs before stopping',async()=>{const a=audio();const ui=await mount();openReading(ui.host);await ui.choose('朗读语速','1.25');await ui.click('设置');await backup(ui);await ui.click('试听声音');const cancel=a.synth.cancel.mock.calls.length;ui.controller.hasPending=()=>true;await ui.click('确认恢复备份');expect(a.synth.cancel.mock.calls.length).toBe(cancel);expect(ui.field('朗读语速').value).toBe('1.25');ui.controller.hasPending=()=>false;ui.controller.replace=async()=>{throw Error('restore fixture failed');};await ui.click('确认恢复备份');expect(a.synth.cancel.mock.calls.length).toBeGreaterThan(cancel);expect(ui.field('朗读语速').value).toBe('1.25');expect(a.submissions).toHaveLength(1);});
it('main and side requests share output; switching back rejects a retained side handler and never replays',async()=>{
 const {createSideChat}=await import('../src/core/sidechat');const initial=fixture();const side=createSideChat({id:'s',columnId:'c',parentMessageId:'main',selectedText:'第一句',sourceMessage:initial.state.columns[0].messages[0].content,columnGoal:'理解函数',now});side.messages=[{id:'side-message',role:'assistant',origin:'assistant',content:'侧聊原文。',createdAt:now}];initial.state.sideChats=[side];
 const a=audio();const ui=await mount(initial);await teaching(ui);await ui.click('朗读这条消息');const main=direct(ui.button('朗读这条消息'));const before=a.synth.cancel.mock.calls.length;await ui.click('侧聊：第一句');expect(a.synth.cancel.mock.calls.length).toBeGreaterThan(before);await act(async()=>main());expect(a.submissions).toHaveLength(1);await ui.click('朗读这条消息');expect(a.submissions.at(-1)?.text).toBe('侧聊原文。');const sideRead=direct(ui.button('朗读这条消息'));await ui.click('主教学');await act(async()=>sideRead());expect(a.submissions).toHaveLength(2);expect(ui.controller.pendingDocument()).toEqual(initial);
});
it('collapsed or hidden saved material rejects retained handlers and live textarea typing is never read',async()=>{const a=audio();const ui=await mount();await ui.click('资料');const b=ui.button('朗读这份材料');const read=direct(b);await act(async()=>read());expect(a.submissions).toHaveLength(0);const details=b.closest('details')!;details.open=true;await act(async()=>read());expect(a.submissions).toHaveLength(1);details.open=false;await act(async()=>read());expect(a.submissions).toHaveLength(1);await ui.click('学习');details.open=true;await act(async()=>read());expect(a.submissions).toHaveLength(1);expect(ui.host.querySelector('textarea[aria-label="选取的片段"]')?.parentElement?.textContent).not.toContain('朗读');});
it('explicit voice disappearance cannot silently fall back; empty voice lists allow explicit unknown default without auto playback',async()=>{const a=audio();const ui=await mount();openReading(ui.host);const id=ui.field('朗读声音').options[1].value;await ui.choose('朗读声音',id);a.setVoices([]);await act(async()=>a.changed());expect(a.submissions).toHaveLength(0);expect(ui.host.textContent).toContain('所选声音已不可用');expect(ui.button('试听声音').disabled).toBe(true);await ui.choose('朗读声音','');expect(ui.host.textContent).toContain('浏览器默认声音 · 来源未知');await ui.click('试听声音');expect(a.submissions).toHaveLength(1);expect(a.submissions[0].voice).toBeNull();});
it('lesson unit change cancels before local switching and unmount detaches audio without starting again',async()=>{const a=audio();const ui=await mount();openReading(ui.host);await ui.click('试听声音');const before=a.synth.cancel.mock.calls.length;a.synth.cancel.mockImplementation(()=>{expect(ui.host.querySelector('.lab-units [aria-pressed="true"]')?.textContent).toContain('函数');});await act(async()=>{const unit=[...ui.host.querySelectorAll<HTMLButtonElement>('.lab-units button')][1];unit.click();expect(a.synth.cancel.mock.calls.length).toBeGreaterThan(before);});a.synth.cancel.mockReset();const ended=a.submissions[0].onend;await act(async()=>ui.root.unmount());mounted.splice(mounted.findIndex(item=>item.root===ui.root),1);await act(async()=>{a.changed();ended?.call(a.submissions[0],{} as SpeechSynthesisEvent);});expect(a.submissions).toHaveLength(1);ui.host.remove();});
it('restore dirty and busy guards preserve playing preview and preferences; discard stops before latest record read',async()=>{const a=audio();const ui=await mount();openReading(ui.host);await ui.choose('朗读语速','0.75');await ui.click('设置');await backup(ui);await ui.click('试听声音');const cancel=a.synth.cancel.mock.calls.length;ui.controller.isBusy=()=>true;const restore=direct(ui.button('确认恢复备份'));await act(async()=>restore());expect(a.synth.cancel.mock.calls.length).toBe(cancel);ui.controller.isBusy=()=>false;await ui.click('取消导入');ui.controller.hasPending=()=>true;ui.controller.storageStatus=()=> 'unsaved';await act(async()=>{await ui.controller.change(d=>d);});const discard=ui.button('放弃待存内容，读取最新记录');ui.controller.reloadLatest=async()=>{expect(a.synth.cancel.mock.calls.length).toBeGreaterThan(cancel);return ui.controller.snapshot();};await act(async()=>discard.click());expect(ui.field('朗读语速').value).toBe('1');expect(a.submissions).toHaveLength(1);});
it('navigation cancels while previous page is still active; current progress comes from actual chunks',async()=>{const a=audio();const initial=fixture();initial.state.columns[0].messages[0].content='长文。'.repeat(100);const ui=await mount(initial);await teaching(ui);await ui.click('朗读这条消息');expect(ui.host.textContent).toContain('1 / 2');await act(async()=>a.submissions[0].onend?.({} as SpeechSynthesisEvent));expect(a.submissions).toHaveLength(2);expect(ui.host.textContent).toContain('2 / 2');a.synth.cancel.mockImplementation(()=>{expect(ui.host.querySelector('.browser-navigation [aria-current="page"]')?.textContent).toBe('学习');});await ui.click('资料');expect(a.submissions).toHaveLength(2);a.synth.cancel.mockReset();});
it('dirty source guard prevents confirmed restoration before output cancellation',async()=>{const a=audio();const ui=await mount();openReading(ui.host);await ui.click('资料');const input=ui.host.querySelector<HTMLTextAreaElement>('[aria-label="选取的片段"]')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'尚未保存的片段');input.dispatchEvent(new Event('input',{bubbles:true}));});await ui.click('设置');await backup(ui);await ui.click('试听声音');const cancel=a.synth.cancel.mock.calls.length;await ui.click('确认恢复备份');expect(a.synth.cancel.mock.calls.length).toBe(cancel);expect(ui.host.textContent).toContain('未保存的片段');expect(a.submissions).toHaveLength(1);});
it('preview text is displayed before its manual read',async()=>{const a=audio();const ui=await mount();openReading(ui.host);expect(ui.host.textContent).toContain('试听文本：这是手动朗读试听。');await ui.choose('朗读语言','en-US');expect(ui.host.textContent).toContain('试听文本：This is a manual reading preview.');await ui.click('试听声音');expect(a.submissions[0].text).toBe('This is a manual reading preview.');});
it.each(['column', 'message'] as const)('controller-published %s invalidation stops synchronously before UI publication and rejects retained read/end',async kind=>{
 const a=audio();const initial=fixture();initial.state.columns[0].messages[0].content='当前长文。'.repeat(100);const ui=await mount(initial);await teaching(ui);const heldRead=direct(ui.button('朗读这条消息'));await ui.click('朗读这条消息');const old=a.submissions[0],oldEnd=old.onend;const cancel=a.synth.cancel.mock.calls.length;
 const next=structuredClone(ui.controller.pendingDocument());if(kind==='column')next.state.activeColumnId='other';else next.state.columns[0].messages=[];
 await act(async()=>{ui.publish(next);expect(a.synth.cancel.mock.calls.length).toBeGreaterThan(cancel);expect(ui.host.querySelector<HTMLElement>('[data-teaching-column="c"]')?.hidden).toBe(false);heldRead();oldEnd?.call(old,{} as SpeechSynthesisEvent);});
 expect(a.submissions).toHaveLength(1);expect(ui.host.querySelector('[data-teaching-column="c"]')).toBeTruthy();if(kind==='column')expect(ui.host.querySelector<HTMLElement>('[data-teaching-column="c"]')?.hidden).toBe(true);else expect(ui.host.querySelector('[data-teaching-column="c"]')?.textContent).not.toContain('当前长文');expect(ui.controller.pendingDocument()).toEqual(next);
});
it('published reference deletion invalidates reading while unrelated document publication keeps valid audio active',async()=>{
 const a=audio();const initial=fixture();initial.drafts.references['https://example.com/source'].text='保存的长文。'.repeat(100);const ui=await mount(initial);await ui.click('资料');const button=ui.button('朗读这份材料');button.closest('details')!.open=true;const heldRead=direct(button);await ui.click('朗读这份材料');const cancel=a.synth.cancel.mock.calls.length;
 const unrelated=structuredClone(ui.controller.pendingDocument());unrelated.state.settings.preferences.name='其他标签页的设置';await act(async()=>ui.publish(unrelated));expect(a.synth.cancel.mock.calls.length).toBe(cancel);expect(a.submissions[0].onend).not.toBeNull();const old=a.submissions[0],oldEnd=old.onend;
 const next=structuredClone(unrelated);next.drafts.references={};await act(async()=>{ui.publish(next);expect(a.synth.cancel.mock.calls.length).toBeGreaterThan(cancel);heldRead();oldEnd?.call(old,{} as SpeechSynthesisEvent);});expect(a.submissions).toHaveLength(1);expect(ui.controller.pendingDocument()).toEqual(next);
});
it.each([['replace','success'],['replace','failure'],['reload','success'],['reload','failure']] as const)('holds reading barrier through deferred %s %s and releases without replay',async(operation,result)=>{
 const a=audio();const ui=await mount();openReading(ui.host);await teaching(ui);const read=direct(ui.button('朗读这条消息'));await ui.click('设置');
 const voiceId=ui.field('朗读声音').options[1].value;await ui.choose('朗读声音',voiceId);await ui.choose('朗读语言','en-US');await ui.choose('朗读语速','1.25');await ui.click('试听声音');
 const preview=direct(ui.button('试听声音')),refresh=direct(ui.button('刷新声音列表')),rate=direct(ui.field('朗读语速'),'onChange'),language=direct(ui.field('朗读语言'),'onChange'),voice=direct(ui.field('朗读声音'),'onChange');
 const getVoices=vi.spyOn(a.synth,'getVoices');const before=structuredClone(ui.controller.pendingDocument());let settle!:()=>void;const gate=new Promise<void>(resolve=>{settle=resolve;});let held=false;ui.controller.isBusy=()=>held;
 const replacement=ui.controller.replace;const latest=ui.controller.reloadLatest;const apply=async(d?:BrowserDocument)=>{held=true;try{await gate;if(result==='failure')throw Error('deferred restoration fixture failed');return d?await replacement(d):await latest();}finally{held=false;}};
 if(operation==='replace'){ui.controller.replace=apply;await backup(ui);}else{ui.controller.hasPending=()=>true;ui.controller.storageStatus=()=> 'unsaved';ui.controller.reloadLatest=()=>apply();await act(async()=>ui.publish(before));}
 const cancel=a.synth.cancel.mock.calls.length;await ui.click(operation==='replace'?'确认恢复备份':'放弃待存内容，读取最新记录');expect(a.synth.cancel.mock.calls.length).toBeGreaterThan(cancel);
 const submissions=a.submissions.length,refreshes=getVoices.mock.calls.length;expect(ui.button('试听声音').disabled).toBe(true);expect(ui.button('刷新声音列表').disabled).toBe(true);expect(ui.field('朗读语速').disabled).toBe(true);
 await ui.click('学习');await teaching(ui);await ui.click('朗读这条消息');await ui.click('试听声音');await ui.click('刷新声音列表');
 await act(async()=>{read();preview();refresh();rate({target:{value:'1.5'}});language({target:{value:'zh-CN'}});voice({target:{value:''}});});
 expect(a.submissions).toHaveLength(submissions);expect(getVoices.mock.calls.length).toBe(refreshes);expect(ui.field('朗读语速').value).toBe('1.25');expect(ui.field('朗读语言').value).toBe('en-US');expect(ui.field('朗读声音').value).toBe(voiceId);expect(ui.controller.pendingDocument()).toEqual(before);
 await act(async()=>settle());expect(a.submissions).toHaveLength(submissions);expect(ui.button('试听声音').disabled).toBe(false);expect(ui.field('朗读语速').value).toBe(result==='success'?'1':'1.25');expect(ui.field('朗读语言').value).toBe(result==='success'?'zh-CN':'en-US');expect(ui.field('朗读声音').value).toBe(result==='success'?'':voiceId);await ui.click('试听声音');expect(a.submissions).toHaveLength(submissions+1);
});
it('ordinary model or lab operation busy state does not hold the reading barrier',async()=>{const a=audio();const ui=await mount();openReading(ui.host);ui.controller.isBusy=()=>true;await ui.choose('朗读语速','1.5');await ui.click('试听声音');expect(a.submissions).toHaveLength(1);expect(a.submissions[0].rate).toBe(1.5);});

it('keeps reading settings closed initially and toggling preserves preferences and active output without document writes',async()=>{
 const a=audio();const getVoices=vi.spyOn(a.synth,'getVoices');const ui=await mount();const before=structuredClone(ui.controller.pendingDocument());
 const details=ui.host.querySelector<HTMLDetailsElement>('.browser-reading details');expect(details).toBeTruthy();expect(details!.open).toBe(false);
 const status=ui.host.querySelector<HTMLElement>('.browser-reading [role="status"]');expect(status).toBeTruthy();expect(status!.textContent).toBe('');expect(a.submissions).toHaveLength(0);
 openReading(ui.host);await ui.choose('朗读语速','1.5');await teaching(ui);await ui.click('朗读这条消息');
 const utterance=a.submissions[0],ended=utterance.onend,cancels=a.synth.cancel.mock.calls.length,refreshes=getVoices.mock.calls.length;
 await act(async()=>{details!.open=false;details!.dispatchEvent(new Event('toggle'));});
 await act(async()=>{details!.open=true;details!.dispatchEvent(new Event('toggle'));});
 expect(a.submissions).toHaveLength(1);expect(utterance.onend).toBe(ended);expect(a.synth.cancel.mock.calls.length).toBe(cancels);expect(getVoices.mock.calls.length).toBe(refreshes);
 expect(ui.field('朗读语速').value).toBe('1.5');expect(ui.controller.pendingDocument()).toEqual(before);
});

it('exposes actual message chunk status and stopping outside closed settings and rejects late completion',async()=>{
 const a=audio();const initial=fixture();initial.state.columns[0].messages[0].content='长文。'.repeat(100);const ui=await mount(initial);
 expect([...ui.host.querySelectorAll('button')].some(b=>b.textContent?.trim()==='停止朗读')).toBe(false);
 const status=ui.host.querySelector<HTMLElement>('.browser-reading [role="status"]')!;expect(status).toBeTruthy();expect(status.textContent).toBe('');
 await teaching(ui);await ui.click('朗读这条消息');expect(ui.host.querySelector('.browser-reading [role="status"]')).toBe(status);
 expect(status.closest('details')).toBeNull();expect(status.getAttribute('aria-live')).toBe('polite');expect(status.textContent).toContain('1 / 2');
 await act(async()=>a.submissions[0].onstart?.({} as SpeechSynthesisEvent));expect(status.textContent).toContain('浏览器已报告开始');
 await act(async()=>a.submissions[0].onend?.({} as SpeechSynthesisEvent));expect(status.textContent).toContain('2 / 2');
 const stop=ui.button('停止朗读');expect(stop.closest('details')).toBeNull();const late=a.submissions[1].onend,cancels=a.synth.cancel.mock.calls.length;
 await ui.click('停止朗读');await act(async()=>late?.call(a.submissions[1],{} as SpeechSynthesisEvent));
 expect(a.submissions).toHaveLength(2);expect(a.synth.cancel.mock.calls.length).toBeGreaterThan(cancels);
 expect([...ui.host.querySelectorAll('button')].some(b=>b.textContent?.trim()==='停止朗读')).toBe(false);
 expect(ui.host.querySelector<HTMLDetailsElement>('.browser-reading details')!.open).toBe(false);
});

it('keeps cancel-failed retry available outside closed settings while reading is suspended',async()=>{
 const a=audio();let permitted=true;const ui=await readingHook(undefined,()=>permitted);
 expect([...ui.host.querySelectorAll('button')].some(b=>b.textContent?.trim()==='停止朗读')).toBe(false);
 await ui.click('测试消息朗读');a.synth.cancel.mockImplementation(()=>{throw Error('injected cancel failure');});
 permitted=false;await ui.render(undefined,true);await act(async()=>ui.current().stop());
 expect(ui.current().snapshot.active).toBeNull();expect(ui.current().snapshot.errorCode).toBe('cancel-failed');
 const stop=[...ui.host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()==='停止朗读')!;
 expect(stop.closest('details')).toBeNull();expect(stop.disabled).toBe(false);a.synth.cancel.mockReset();await ui.click('停止朗读');
 expect(ui.current().snapshot.errorCode).toBeNull();expect(ui.current().snapshot.phase).toBe('stopped');expect(a.submissions).toHaveLength(1);
 expect([...ui.host.querySelectorAll('button')].some(b=>b.textContent?.trim()==='停止朗读')).toBe(false);
});

it('rejects retained configuration actions when collapsed, hidden, inert or detached and allows them again when visible',async()=>{
 const a=audio();const getVoices=vi.spyOn(a.synth,'getVoices');const ui=await mount();openReading(ui.host);
 const preview=direct(ui.button('试听声音')),refresh=direct(ui.button('刷新声音列表'));
 const voice=direct(ui.field('朗读声音'),'onChange'),language=direct(ui.field('朗读语言'),'onChange'),rate=direct(ui.field('朗读语速'),'onChange');
 const voiceId=ui.field('朗读声音').options[1].value;const before=structuredClone(ui.controller.pendingDocument());const refreshes=getVoices.mock.calls.length;
 const details=ui.host.querySelector<HTMLDetailsElement>('.browser-reading details');
 for(const state of ['collapsed','hidden','inert','detached']){
   if(state==='collapsed'&&details)details.open=false;if(state==='hidden')ui.host.hidden=true;if(state==='inert')ui.host.setAttribute('inert','');if(state==='detached')ui.host.remove();
   await act(async()=>{preview();refresh();voice({target:{value:voiceId}});language({target:{value:'en-US'}});rate({target:{value:'1.5'}});});
   expect(a.submissions,state).toHaveLength(0);expect(getVoices.mock.calls.length,state).toBe(refreshes);
   expect(ui.field('朗读声音').value,state).toBe('');expect(ui.field('朗读语言').value,state).toBe('zh-CN');expect(ui.field('朗读语速').value,state).toBe('1');
   if(details)details.open=true;ui.host.hidden=false;ui.host.removeAttribute('inert');if(!ui.host.isConnected)document.body.append(ui.host);
 }
 await act(async()=>refresh());expect(getVoices.mock.calls.length).toBe(refreshes+1);
 await act(async()=>rate({target:{value:'1.5'}}));await act(async()=>language({target:{value:'en-US'}}));
 await act(async()=>voice({target:{value:voiceId}}));await act(async()=>rate({target:{value:'0.75'}}));
 expect(ui.field('朗读语言').value).toBe('en-US');expect(ui.field('朗读声音').value).toBe(voiceId);
 await act(async()=>preview());expect(a.submissions[0].rate).toBe(0.75);expect(a.submissions[0].text).toBe('This is a manual reading preview.');
 expect(ui.controller.pendingDocument()).toEqual(before);
});

it('rechecks latest suspended and permitted state in retained configuration handlers without replay after release',async()=>{
 const a=audio();const getVoices=vi.spyOn(a.synth,'getVoices');let permitted=true;const ui=await readingHook(undefined,()=>permitted);openReading(ui.host);
 const button=(label:string)=>[...ui.host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===label)!;
 const field=(label:string)=>ui.host.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
 const preview=direct(button('试听声音')),refresh=direct(button('刷新声音列表')),voice=direct(field('朗读声音'),'onChange'),language=direct(field('朗读语言'),'onChange'),rate=direct(field('朗读语速'),'onChange');
 const voiceId=field('朗读声音').options[1].value,refreshes=getVoices.mock.calls.length;
 const retained=()=>{preview();refresh();voice({target:{value:voiceId}});language({target:{value:'en-US'}});rate({target:{value:'1.5'}});};
 await ui.render(undefined,true);await act(async()=>retained());expect(a.submissions).toHaveLength(0);expect(getVoices.mock.calls.length).toBe(refreshes);expect(ui.current().preferences).toEqual({voiceId:null,language:'zh-CN',rate:1});
 await ui.render(undefined,false);permitted=false;await act(async()=>retained());expect(a.submissions).toHaveLength(0);expect(getVoices.mock.calls.length).toBe(refreshes);expect(ui.current().preferences).toEqual({voiceId:null,language:'zh-CN',rate:1});
 permitted=true;await ui.render();expect(a.submissions).toHaveLength(0);await ui.click('试听声音');expect(a.submissions).toHaveLength(1);
});
