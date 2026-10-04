// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, expect, it, vi} from 'vitest';
import {IDBFactory} from 'fake-indexeddb';
import {emptyBrowserDocument} from '../src/core/browser-state';
import {createBrowserController, type BrowserController} from '../src/browser/controller';
import {openBrowserRepository, BrowserStorageError} from '../src/browser/repository';
import {createColumn, confirmPlan, beginStudy, markTaught, beginVerification} from '../src/core/learning';
import type {ChatInput, ModelSession} from '../src/core/model-session';
import {createBackup, readBackup} from '../src/core/backup';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: Array<{root:Root;host:HTMLElement;controller:BrowserController}> = [];
afterEach(async()=>{for(const ui of mounted.splice(0)){await act(async()=>ui.root.unmount());ui.controller.close();ui.host.remove();}});
const now='2026-10-05T00:00:00.000Z';
const column = (phase='study') => {const c=beginStudy(confirmPlan(createColumn('函数','运行函数',now,'c'),{target:'运行函数',steps:[{id:'s',title:'参数',outcome:'运行例子',priority:1}]},now));return phase==='verify'?beginVerification(markTaught(c)):c;};
const profile={id:'p',name:'测试服务',baseUrl:'https://model.example/v1',protocol:'chat' as const,models:['m']};
async function mount(phase='study',chat:ModelSession['chat']=async()=> 'AI 讲解',suspended=false){
 const repository=await openBrowserRepository(new IDBFactory());const initial=emptyBrowserDocument();initial.state.columns=[column(phase)];initial.state.settings.modelLibrary={profiles:[profile],active:{profileId:'p',model:'m'}};await repository.commit(initial,0);const controller=await createBrowserController(repository);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);mounted.push({host,root,controller});const onDirty=vi.fn();const models={chat,compact:vi.fn(async(_input:Parameters<ModelSession['compact']>[0],_signal?:AbortSignal)=>{}),test:vi.fn(async()=> 'OK'),clear:vi.fn(),dispose:vi.fn()};
 const {MobileTeaching}=await import('../src/browser/teaching');
 await act(async()=>root.render(<MobileTeaching columnId="c" controller={controller} models={models} suspended={suspended} onDirty={onDirty}/>));
 // A completed click includes the real controller operation/transaction boundary.
 // Intentional deferred tests opt out, then await their exact provider/commit gate.
 const settle = async () => {
   await act(async () => {
     if (!controller.isBusy()) return;
     await new Promise<void>(resolve => {
       const off = controller.subscribe(() => {if (!controller.isBusy()) {off(); resolve();}});
     });
   });
 };
 const click = async (label: string, waitForCompletion = true) => {
   const button = [...host.querySelectorAll('button')].find(node => node.textContent?.trim() === label);
   expect(button, `button ${label}`).toBeTruthy();
   await act(async () => {button!.click();});
   if (waitForCompletion) await settle();
 };
 const type=async(label:string,value:string)=>{const f=host.querySelector<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>(`[aria-label="${label}"]`)!;expect(f,`field ${label}`).toBeTruthy();await act(async()=>{Object.getOwnPropertyDescriptor(Object.getPrototypeOf(f),'value')!.set!.call(f,value);f.dispatchEvent(new Event(f.tagName==='SELECT'?'change':'input',{bubbles:true}));await controller.flush();});};
 return {host,controller,repository,models,onDirty,click,type,settle};
}
it('does not assess on open and requires studied gate before verification',async()=>{const chat=vi.fn(async()=> '讲解');const ui=await mount('study',chat);expect(chat).not.toHaveBeenCalled();expect(ui.controller.pendingDocument().state.columns[0].evidence).toEqual([]);await ui.click('进入学后验证');expect(ui.host.textContent).toContain('先学习当前知识块');await ui.click('这块已学过');await ui.click('进入学后验证');expect(ui.controller.pendingDocument().state.columns[0].phase).toBe('verify');expect(chat).not.toHaveBeenCalled();});
it('keeps material and AI drafts ask-only even during verification and preserves exact learner evidence',async()=>{const ui=await mount('verify');await act(async()=>{await ui.controller.change(d=>({...d,drafts:{...d.drafts,messages:{'material:c':'未核验材料','ai:c':'AI结论'}}}));});await ui.click('材料提问');expect(ui.host.querySelector('[aria-label="我的学后回答"]')).toBeNull();await ui.click('发送材料提问');expect(ui.controller.pendingDocument().state.columns[0].phase).toBe('verify');expect(ui.controller.pendingDocument().state.columns[0].evidence).toEqual([]);await ui.click('自己的回答');const answer='  中文\n    return name;\n ';await ui.type('我的学后回答',answer);await ui.type('使用帮助程度','explained');await ui.type('使用帮助程度','independent');await ui.click('保存自己的回答');expect(ui.controller.pendingDocument().state.columns[0].pendingAnswer).toMatchObject({text:answer,helpLevel:'explained'});const back='\n  我理解参数  \n';await ui.type('我的复述',back);await ui.click('保存自己的复述');const e=readBackup(createBackup(ui.controller.pendingDocument(),'0.9.0',now)).state.columns[0].evidence[0];expect(e).toMatchObject({answer,teachback:back,helpLevel:'explained',confirmed:false,level:'待验证'});});
it('serializes duplicate sends, respects composition and retains newer draft until reply is durable',async()=>{let resolve!:(s:string)=>void;const chat=vi.fn((_input:ChatInput)=>new Promise<string>(r=>resolve=r));const ui=await mount('study',chat);await ui.type('向 AI 提问','  原问题\n ');const field=ui.host.querySelector('[aria-label="向 AI 提问"]')!;await act(async()=>field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true})));expect(chat).not.toHaveBeenCalled();await ui.click('发送问题',false);await act(async()=>{await vi.waitFor(()=>expect(chat).toHaveBeenCalledTimes(1));});await ui.click('发送问题',false);expect(chat).toHaveBeenCalledTimes(1);await ui.type('向 AI 提问','新问题');await act(async()=>resolve('AI 返回'));await ui.settle();expect(ui.controller.pendingDocument().drafts.messages['question:c']).toBe('新问题');expect(ui.controller.pendingDocument().state.columns[0].messages.map(m=>m.content)).toEqual(['  原问题\n ','AI 返回']);expect(chat.mock.calls[0][0]).toMatchObject({scope:'c',task:'  原问题\n '});});
it.each(['failure','textless','abort'])('retains exact draft on %s',async kind=>{let started!:()=>void;const dispatched=new Promise<void>(resolve=>{started=resolve;});const chat=async(_input:ChatInput,signal?:AbortSignal)=>{started();if(kind==='textless')return '';if(kind==='abort')return new Promise<string>((_r,reject)=>signal!.addEventListener('abort',()=>reject(Error('已取消'))));throw Error('网络不可用');};const ui=await mount('study',chat);await ui.type('向 AI 提问','  保留\n ');await ui.click('发送问题',kind!=='abort');if(kind==='abort'){await dispatched;await ui.click('取消请求');}await act(async()=>{});expect(ui.controller.pendingDocument().drafts.messages['question:c']).toBe('  保留\n ');expect(ui.controller.pendingDocument().state.columns[0].evidence).toEqual([]);});
it('holds restore exclusion through assistant persistence and recovers storage without another paid request',async()=>{const chat=vi.fn(async()=> '付费回复');const ui=await mount('study',chat);await ui.type('向 AI 提问','问题');const commit=ui.repository.commit;let release!:()=>void;let entered!:()=>void;const committing=new Promise<void>(resolve=>{entered=resolve;});let block=true;ui.repository.commit=async(d,r)=>{if(block&&d.state.columns[0].messages.some(m=>m.role==='assistant')){await new Promise<void>(resolve=>{release=resolve;entered();});throw new BrowserStorageError('quota','空间不足');}return commit(d,r);};await ui.click('发送问题',false);await committing;expect(ui.controller.isBusy()).toBe(true);await expect(ui.controller.replace(emptyBrowserDocument())).rejects.toThrow();await act(async()=>release());await ui.settle();expect(ui.controller.pendingDocument().state.columns[0].messages.at(-1)?.content).toBe('付费回复');expect(ui.controller.pendingDocument().drafts.messages['question:c']).toBe('问题');block=false;await ui.click('仅重试保存');expect(chat).toHaveBeenCalledTimes(1);expect(ui.controller.pendingDocument().state.columns[0].messages).toHaveLength(2);expect(ui.controller.pendingDocument().drafts.messages['question:c']).toBe('');});
it('creates independent side scope and carries unsent AI material without overwriting a target draft',async()=>{const chat=vi.fn(async(input:ChatInput)=>input.purpose==='side'?'侧聊结论':'主聊回复');const ui=await mount('study',chat);await ui.type('向 AI 提问','问题');await ui.click('发送问题');await act(async()=>[...ui.host.querySelectorAll('button')].filter(b=>b.textContent==='围绕这段开侧聊').at(-1)!.click());await ui.type('侧聊选取文字','主聊');await ui.click('确认创建侧聊');await ui.type('侧聊问题','解释选区');await ui.click('发送侧聊问题');const call=chat.mock.calls.at(-1)![0];expect(call.scope).toMatch(/^side:/);expect(call.turns).toEqual([]);expect(call.system).toContain('主聊回复');await act(async()=>{await ui.controller.change(d=>({...d,drafts:{...d.drafts,messages:{...d.drafts.messages,'ai:c':'既有草稿','question:other':'另一栏目'}}}));});await ui.click('带回原栏目草稿');expect(ui.host.textContent).toContain('已有 AI 材料草稿');expect(ui.controller.pendingDocument().drafts.messages['ai:c']).toBe('既有草稿');await act(async()=>{await ui.controller.change(d=>({...d,drafts:{...d.drafts,messages:{...d.drafts.messages,'ai:c':''}}}));});await ui.click('带回原栏目草稿');expect(readBackup(createBackup(ui.controller.pendingDocument(),'0.9.0',now)).drafts.messages['ai:c']).toContain('侧聊结论');expect(ui.controller.pendingDocument().drafts.messages['question:other']).toBe('另一栏目');expect(ui.controller.pendingDocument().state.columns[0].evidence).toEqual([]);expect(chat).toHaveBeenCalledTimes(2);});
it('update held handlers cannot create local or pending mutations',async()=>{const ui=await mount('study',async()=> 'text',true);const before=ui.controller.pendingDocument();await ui.type('向 AI 提问','非法后续编辑');await ui.click('这块已学过');expect(ui.controller.pendingDocument()).toEqual(before);});
it('refuses a paid dispatch when the exact user transcript cannot save',async()=>{const chat=vi.fn(async(_input:ChatInput)=>'reply');const ui=await mount('study',chat);await ui.type('向 AI 提问','  保存失败的原输入\n');ui.repository.commit=async()=>{throw new BrowserStorageError('quota','空间不足');};await ui.click('发送问题');expect(chat).not.toHaveBeenCalled();expect(ui.controller.pendingDocument().drafts.messages['question:c']).toBe('  保存失败的原输入\n');expect(ui.controller.pendingDocument().state.columns[0].messages[0].content).toBe('  保存失败的原输入\n');});
it('late reply merges with concurrent context, usage, lab, settings and other-column drafts',async()=>{let resolve!:(s:string)=>void;const ui=await mount('study',()=>new Promise<string>(r=>resolve=r));await ui.type('向 AI 提问','问题');await ui.click('发送问题',false);await act(async()=>{await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));});await act(async()=>{await ui.controller.change(d=>({...d,state:{...d.state,contexts:{other:{checkpoint:{summary:'另一上下文',throughId:'x',createdAt:now}}},usageRecords:[{id:'concurrent',createdAt:now,profileId:'p',model:'m',purpose:'test',usage:null}],settings:{...d.state.settings,preferences:{...d.state.settings.preferences,name:'同步设置'}}},drafts:{...d.drafts,messages:{...d.drafts.messages,'question:other':'其他草稿'}}}));});await act(async()=>{resolve('付费回复');});await ui.settle();const d=ui.controller.pendingDocument();expect(d.state.contexts.other.checkpoint?.summary).toBe('另一上下文');expect(d.state.usageRecords[0].id).toBe('concurrent');expect(d.state.settings.preferences.name).toBe('同步设置');expect(d.drafts.messages['question:other']).toBe('其他草稿');expect(d.state.columns[0].messages.at(-1)?.model).toBe('m');});
it('recovers a session storage failure with the same immutable IDs and no repeated model POST',async()=>{
 const {BrowserModelPort}=await import('../src/browser/model-port');const {createModelSession}=await import('../src/core/model-session');
 const fetch=vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:'付费原回复'}}],usage:{prompt_tokens:5,completion_tokens:2}}),{status:200}));
 const ui=await mount();const port=new BrowserModelPort(fetch);port.setKey(profile,'fixture-key');const session=createModelSession(port,ui.controller);ui.models.chat=session.chat;
 await ui.type('向 AI 提问','付费原问题');const commit=ui.repository.commit;let fail=true;ui.repository.commit=async(d,r)=>{if(fail&&d.state.usageRecords.length)throw new BrowserStorageError('quota','容量不足');return commit(d,r);};await ui.click('发送问题');expect(fetch).toHaveBeenCalledTimes(1);expect(ui.controller.pendingDocument().state.usageRecords).toHaveLength(1);expect(ui.controller.pendingDocument().drafts.messages['question:c']).toBe('付费原问题');fail=false;await ui.click('仅重试保存');expect(fetch).toHaveBeenCalledTimes(1);expect(ui.controller.pendingDocument().state.columns[0].messages.map(m=>m.content)).toEqual(['付费原问题','付费原回复']);expect(ui.controller.pendingDocument().state.usageRecords).toHaveLength(1);session.dispose();
});
it('refuses material send when provenance plus selected text exceeds the draft payload limit',async()=>{const chat=vi.fn(async(_input:ChatInput)=>'reply');const ui=await mount('verify',chat);await ui.click('材料提问');await ui.type('材料提问草稿','x'.repeat(20000));await ui.click('发送材料提问');expect(chat).not.toHaveBeenCalled();expect(ui.controller.pendingDocument().drafts.messages['material:c']).toHaveLength(20000);expect(ui.host.textContent).toContain('20,000');expect(ui.controller.pendingDocument().state.columns[0].messages).toEqual([]);});

it('records increased help declared during teachback rather than the earlier independent answer', async () => {
  const ui = await mount('verify');
  await ui.click('自己的回答');
  await ui.type('我的学后回答', '我独立写出的回答');
  await ui.click('保存自己的回答');
  expect(ui.controller.pendingDocument().state.columns[0].pendingAnswer?.helpLevel).toBe('independent');
  await ui.type('使用帮助程度', 'explained');
  await ui.type('使用帮助程度', 'independent');
  await ui.type('我的复述', '看过讲解后写出的复述');
  await ui.click('保存自己的复述');
  expect(ui.controller.pendingDocument().state.columns[0].evidence[0]).toMatchObject({
    answer: '我独立写出的回答', teachback: '看过讲解后写出的复述',
    helpLevel: 'explained', level: '待验证', confirmed: false,
  });
});

it.each(['发送问题', '整理当前上下文'])('keeps original paid recovery reachable when a later %s is attempted', async action => {
  const {BrowserModelPort} = await import('../src/browser/model-port');
  const {createModelSession} = await import('../src/core/model-session');
  const fetch = vi.fn(async () => new Response(JSON.stringify({
    choices: [{message: {content: '第一条付费回复'}}], usage: {prompt_tokens: 5, completion_tokens: 2},
  }), {status: 200}));
  const ui = await mount();
  const port = new BrowserModelPort(fetch); port.setKey(profile, 'fixture-key');
  const session = createModelSession(port, ui.controller);
  ui.models.chat = session.chat; ui.models.compact = vi.fn(session.compact);
  const commit = ui.repository.commit;
  let fail = true;
  ui.repository.commit = async (document, revision) => {
    if (fail && document.state.usageRecords.length) throw new BrowserStorageError('quota', '容量不足');
    return commit(document, revision);
  };
  await ui.type('向 AI 提问', '第一条原问题');
  await ui.click('发送问题');
  expect(fetch).toHaveBeenCalledTimes(1);
  fail = false;
  await ui.type('向 AI 提问', '后写的新问题');
  await ui.click(action);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(ui.models.compact).not.toHaveBeenCalled();
  expect([...ui.host.querySelectorAll('button')].some(button => button.textContent === '仅重试保存')).toBe(true);
  await ui.click('仅重试保存');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(ui.controller.pendingDocument().state.columns[0].messages.map(message => message.content)).toEqual(['第一条原问题', '第一条付费回复']);
  expect(ui.controller.pendingDocument().drafts.messages['question:c']).toBe('后写的新问题');
  session.dispose();
});

it('keeps a newer side selection and dirty status after an earlier selection finishes saving', async () => {
  const ui = await mount('study', async () => '第一段和第二段');
  await ui.type('向 AI 提问', '解释材料'); await ui.click('发送问题');
  await act(async () => [...ui.host.querySelectorAll('button')].filter(button => button.textContent === '围绕这段开侧聊').at(-1)!.click());
  await ui.type('侧聊选取文字', '第一段');
  const commit = ui.repository.commit;
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  ui.repository.commit = async (document, revision) => {await gate; return commit(document, revision);};
  await ui.click('确认创建侧聊', false);
  const field = ui.host.querySelector<HTMLTextAreaElement>('[aria-label="侧聊选取文字"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, '第二段');
    field.dispatchEvent(new Event('input', {bubbles: true}));
  });
  await act(async () => {release(); await ui.controller.flush();});
  expect(ui.host.querySelector<HTMLTextAreaElement>('[aria-label="侧聊选取文字"]')?.value).toBe('第二段');
  expect(ui.onDirty).toHaveBeenLastCalledWith(true);
  expect(ui.controller.pendingDocument().state.sideChats[0].context.quote).toBe('第一段');
});

it('allows an independent side scope while the main scope still requires paid recovery', async () => {
  const {BrowserModelPort} = await import('../src/browser/model-port');
  const {createModelSession} = await import('../src/core/model-session');
  const fetch = vi.fn(async () => new Response(JSON.stringify({
    choices: [{message: {content: '保留的付费回复'}}], usage: {prompt_tokens: 5, completion_tokens: 2},
  }), {status: 200}));
  const ui = await mount();
  const port = new BrowserModelPort(fetch); port.setKey(profile, 'fixture-key');
  const session = createModelSession(port, ui.controller); ui.models.chat = session.chat;
  const commit = ui.repository.commit;
  let fail = true;
  ui.repository.commit = async (document, revision) => {
    if (fail && document.state.usageRecords.length) throw new BrowserStorageError('quota', '容量不足');
    return commit(document, revision);
  };
  await ui.type('向 AI 提问', '原问题'); await ui.click('发送问题');
  fail = false;
  await ui.type('向 AI 提问', '新的主问题');
  await ui.click('围绕这段开侧聊'); await ui.type('侧聊选取文字', '原问题');
  await ui.click('确认创建侧聊'); await ui.type('侧聊问题', '只讨论选区');
  await ui.click('发送侧聊问题');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(ui.controller.pendingDocument().state.sideChats[0].messages.map(message => message.content)).toEqual(['只讨论选区', '保留的付费回复']);
  await ui.click('主教学'); await ui.click('仅重试保存');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(ui.controller.pendingDocument().state.columns[0].messages.map(message => message.content)).toEqual(['原问题', '保留的付费回复']);
  expect(ui.controller.pendingDocument().drafts.messages['question:c']).toBe('新的主问题');
  session.dispose();
});

it('waits for a held assistant commit before treating a click as complete', async () => {
  const ui = await mount('study', async () => '受控回复');
  await ui.type('向 AI 提问', '受控问题');
  const commit = ui.repository.commit;
  let reached!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => {reached = resolve;});
  const gate = new Promise<void>(resolve => {release = resolve;});
  ui.repository.commit = async (document, revision) => {
    if (document.state.columns[0].messages.some(message => message.role === 'assistant')) {reached(); await gate;}
    return commit(document, revision);
  };
  const clicking = ui.click('发送问题');
  await entered;
  expect(ui.controller.isBusy()).toBe(true);
  expect(ui.controller.snapshot().document.state.columns[0].messages).toHaveLength(1);
  expect(ui.controller.pendingDocument().state.columns[0].messages).toHaveLength(2);
  release(); await clicking;
  expect(ui.controller.isBusy()).toBe(false);
  expect(ui.controller.snapshot().document.state.columns[0].messages.map(message => message.content)).toEqual(['受控问题', '受控回复']);
  expect(ui.controller.pendingDocument().drafts.messages['question:c']).toBe('');
});

it('waits for a held side commit before accessing the activated side field', async () => {
  const ui = await mount('study', async () => '受控片段');
  await ui.type('向 AI 提问', '原问题'); await ui.click('发送问题');
  await ui.click('围绕这段开侧聊'); await ui.type('侧聊选取文字', '原问题');
  const commit = ui.repository.commit;
  let reached!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => {reached = resolve;});
  const gate = new Promise<void>(resolve => {release = resolve;});
  ui.repository.commit = async (document, revision) => {reached(); await gate; return commit(document, revision);};
  const clicking = ui.click('确认创建侧聊');
  await entered;
  expect(ui.controller.isBusy()).toBe(true);
  expect(ui.controller.snapshot().document.state.sideChats).toHaveLength(0);
  expect(ui.controller.pendingDocument().state.sideChats).toHaveLength(1);
  expect(ui.host.querySelector('[aria-label="侧聊问题"]')).toBeNull();
  release(); await clicking;
  expect(ui.controller.isBusy()).toBe(false);
  expect(ui.controller.snapshot().document.state.sideChats).toHaveLength(1);
  expect(ui.host.querySelector('[aria-label="侧聊问题"]')).not.toBeNull();
});
