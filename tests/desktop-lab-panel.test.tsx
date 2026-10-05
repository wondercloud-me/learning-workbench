// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, expect, it, vi} from 'vitest';
import {emptyBrowserDocument, type BrowserDocument} from '../src/core/browser-state';
import {beginLab, setLabCode, type LabRun} from '../src/core/lab';
import type {DesktopSnapshot, DesktopWrite} from '../src/core/desktop-document';
import {createDesktopDocumentController, type DesktopDocumentPort} from '../src/renderer/desktop-document';
import {DesktopLabPanel} from '../src/renderer/desktop-lab-panel';
const engine=vi.hoisted(()=>({execute:vi.fn()}));
vi.mock('../src/renderer/lab-client',()=>({executeLab:engine.execute}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const code='function greeting(name) { return "你好，" + name; }';
const explanation='把传入名字与前缀拼接，返回新的欢迎字符串。';
const run=(text=code):LabRun=>({code:text,taskId:'greeting',error:'',logs:['原运行日志'],checks:[{label:'普通名字',passed:true,expected:'你好，小林',actual:'你好，小林'},{label:'名字来自输入',passed:true,expected:'你好，Ada',actual:'你好，Ada'},{label:'不要写死名字',passed:true,expected:'你好，同学',actual:'你好，同学'}]});
const fixtures=()=>{const document=emptyBrowserDocument();document.state.lab=setLabCode(beginLab(document.state.lab,'functions','practice','2026-10-05T08:00:00.000Z'),'functions','practice',code);return document;};
const hosts:Array<{host:HTMLDivElement;root:Root}>=[];
afterEach(async()=>{for(const {host,root} of hosts.splice(0)){await act(async()=>root.unmount());host.remove();}engine.execute.mockReset();});
async function setup(document=fixtures()) {
 let durable:DesktopSnapshot={document:structuredClone(document),generation:1,revision:1,mutationRevision:0};
 const port:DesktopDocumentPort={load:vi.fn(async()=>structuredClone(durable)),save:vi.fn(async(write:DesktopWrite)=>{durable={...structuredClone(write),revision:durable.revision+1};return structuredClone(durable);}),exportBackup:vi.fn(async()=>true),importBackup:vi.fn(async()=>null)};
 const controller=createDesktopDocumentController(port);await controller.start();
 const host=window.document.createElement('div');window.document.body.append(host);const root=createRoot(host);hosts.push({host,root});
 const render=async(shown=true)=>{await act(async()=>root.render(<div hidden={!shown}><DesktopLabPanel controller={controller}/></div>));};await render();
 const field=(label:string)=>host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)!;
 const button=(label:string)=>{const found=[...host.querySelectorAll('button')].find(item=>item.textContent?.trim()===label);if(!found)throw Error(`missing ${label}`);return found;};
 const click=async(label:string)=>{await act(async()=>button(label).click());};
 const input=async(label:string,text:string)=>{await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(field(label),text);field(label).dispatchEvent(new Event('input',{bubbles:true}));});};
 return {controller,port,host,root,render,field,button,click,input,durable:()=>durable};
}
it('restores real persisted code, explanation and historical feedback without auto-running or certifying a new attempt',async()=>{
 const document=fixtures();document.drafts.lab['functions:practice']={explanation,lastRun:run(),updatedAt:'2026-10-05T08:00:00.000Z'};
 const ui=await setup(document);expect(ui.field('你的代码').value).toBe(code);expect(ui.field('用自己的话解释').value).toBe(explanation);expect(ui.host.textContent).toContain('上次运行的反馈已恢复');expect(ui.button('保存此次产出').disabled).toBe(true);expect(engine.execute).not.toHaveBeenCalled();expect(ui.port.save).not.toHaveBeenCalled();
});
it('persists paired code/draft changes and explanation across hiding and a fresh controller load',async()=>{
 const ui=await setup();await ui.input('用自己的话解释',explanation);await ui.input('你的代码',code+'\n// 用户保留的文字');await ui.render(false);await ui.render(true);expect(ui.field('用自己的话解释').value).toBe(explanation);
 await ui.controller.flush();const fresh=createDesktopDocumentController(ui.port);await fresh.start();await act(async()=>ui.root.render(<DesktopLabPanel controller={fresh}/>));expect(ui.field('你的代码').value).toBe(code+'\n// 用户保留的文字');expect(ui.field('用自己的话解释').value).toBe(explanation);expect(fresh.snapshot().document.drafts.lab['functions:practice'].lastRun).toBeNull();
});
it('waits for the actual save ACK, preserves failed input and retries exactly one attempt identity',async()=>{
 const ui=await setup();engine.execute.mockImplementation(async()=>run());await ui.input('用自己的话解释',explanation);await ui.click('运行代码');
 let reject!:(error:Error)=>void;vi.mocked(ui.port.save).mockImplementationOnce(()=>new Promise((_yes,no)=>{reject=no;}));await ui.click('保存此次产出');expect(ui.button('保存中…').disabled).toBe(true);expect(ui.host.querySelectorAll('.lab-attempt')).toHaveLength(0);const id=ui.controller.snapshot().document.state.lab.attempts[0].id;
 await act(async()=>reject(Error('disk full')));expect(ui.host.textContent).toContain('尚未保存：disk full');expect(ui.field('用自己的话解释').value).toBe(explanation);await ui.click('保存此次产出');expect(ui.controller.snapshot().document.state.lab.attempts).toHaveLength(1);expect(ui.controller.snapshot().document.state.lab.attempts[0].id).toBe(id);expect(ui.host.querySelectorAll('.lab-attempt')).toHaveLength(1);
});
it('failed barriers remount only durable history and preserve a failed attempt identity for rerun retry',async()=>{
 const ui=await setup();engine.execute.mockImplementation(async()=>run());await ui.input('用自己的话解释',explanation);await ui.click('运行代码');vi.mocked(ui.port.save).mockRejectedValueOnce(Error('disk full'));await ui.click('保存此次产出');const id=ui.controller.snapshot().document.state.lab.attempts[0].id;
 vi.mocked(ui.port.save).mockRejectedValueOnce(Error('retry failed'));await act(async()=>{await expect(ui.controller.exportBackup()).rejects.toThrow('retry failed');});expect(ui.host.querySelectorAll('.lab-attempt')).toHaveLength(0);expect(ui.host.textContent).toContain('0 次尝试');expect(ui.button('保存此次产出').disabled).toBe(true);expect(ui.field('用自己的话解释').value).toBe(explanation);
 await ui.click('运行代码');expect(ui.controller.snapshot().committedDocument.state.lab.attempts[0].explanation).toBe(explanation);
 const changedExplanation='修改后的解释：输入名字经拼接成为返回值，原文保留。';await ui.input('用自己的话解释',changedExplanation);
 let rejectSave!:(error:Error)=>void;vi.mocked(ui.port.save).mockImplementationOnce(()=>new Promise((_yes,no)=>{rejectSave=no;}));await ui.click('保存此次产出');
 expect(ui.controller.snapshot().document.state.lab.attempts[0]).toMatchObject({id,explanation:changedExplanation});
 expect(ui.host.querySelector('.lab-attempt')!.textContent).toContain(explanation);expect(ui.host.querySelector('.lab-attempt')!.textContent).not.toContain(changedExplanation);
 await act(async()=>rejectSave(Error('second save failed')));expect(ui.host.querySelector('.lab-attempt')!.textContent).toContain(explanation);expect(ui.host.querySelector('.lab-attempt')!.textContent).not.toContain(changedExplanation);
 let rejectHint!:(error:Error)=>void;vi.mocked(ui.port.save).mockImplementationOnce(()=>new Promise((_yes,no)=>{rejectHint=no;}));await ui.click('查看下一层提示');
 expect(ui.controller.snapshot().document.state.lab.attempts).toHaveLength(1);expect(ui.controller.snapshot().document.state.lab.attempts[0]).toMatchObject({id,explanation:changedExplanation});
 expect(ui.host.querySelector('.lab-attempt')!.textContent).toContain(explanation);await act(async()=>rejectHint(Error('hint save failed')));
 await ui.click('保存此次产出');expect(ui.controller.snapshot().document.state.lab.attempts).toHaveLength(1);expect(ui.controller.snapshot().document.state.lab.attempts[0]).toMatchObject({id,explanation:changedExplanation});expect(ui.host.querySelectorAll('.lab-attempt')).toHaveLength(1);expect(ui.host.querySelector('.lab-attempt')!.textContent).toContain(changedExplanation);
});
it('synchronous locks abort execution and successful restore rejects retained callbacks and old results',async()=>{
 const ui=await setup();let complete!:(value:LabRun)=>void,signal:AbortSignal|undefined;engine.execute.mockImplementation((_code,_task,abort)=>{signal=abort;return new Promise(yes=>{complete=yes;});});await ui.click('运行代码');
 const field=ui.field('你的代码');const reactKey=Object.keys(field).find(key=>key.startsWith('__reactProps$'))!;const retained=(field as any)[reactKey].onChange as (event:{target:{value:string}})=>void;
 let restore!:(snapshot:DesktopSnapshot|null)=>void;vi.mocked(ui.port.importBackup).mockImplementationOnce(()=>new Promise(yes=>{restore=yes;}));let importing!:Promise<boolean>;await act(async()=>{importing=ui.controller.importBackup();});expect(signal?.aborted).toBe(true);expect(ui.host.querySelector('.lab-panel')).toBeNull();
 const document=fixtures();document.drafts.lab['functions:practice']={explanation:'这是导入后必须保留的解释原文。',lastRun:null,updatedAt:'2026-10-05T08:00:00.000Z'};
 await act(async()=>{restore({document,generation:2,revision:20,mutationRevision:0});await importing;});const before=structuredClone(ui.controller.snapshot().document);await act(async()=>{retained({target:{value:'stale overwrite'}});complete(run());});expect(ui.controller.snapshot().document).toEqual(before);expect(ui.field('用自己的话解释').value).toBe('这是导入后必须保留的解释原文。');expect(ui.host.querySelector('[aria-label="本次运行结果"]')).toBeNull();
});
