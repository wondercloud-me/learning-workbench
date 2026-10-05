import {expect, it, vi} from 'vitest';
import {emptyBrowserDocument, type BrowserDocument} from '../src/core/browser-state';
import type {DesktopSnapshot, DesktopWrite} from '../src/core/desktop-document';
import {createDesktopDocumentController, type DesktopDocumentPort} from '../src/renderer/desktop-document';

function deferred<T>() {let resolve!:(value:T)=>void, reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture(initial:DesktopSnapshot={document:emptyBrowserDocument(),generation:3,revision:8,mutationRevision:4}) {
 const writes:Array<{write:DesktopWrite; gate:ReturnType<typeof deferred<DesktopSnapshot>>}>=[];
 const port:DesktopDocumentPort={load:vi.fn(async()=>structuredClone(initial)),save:vi.fn(write=>{const gate=deferred<DesktopSnapshot>();writes.push({write:structuredClone(write),gate});return gate.promise;}),exportBackup:vi.fn(async()=>true),importBackup:vi.fn(async()=>null)};
 const controller=createDesktopDocumentController(port);
 const ack=(index:number,extra:Partial<DesktopSnapshot>={})=>{const {write,gate}=writes[index];gate.resolve({...write,revision:initial.revision+index+1,...extra});};
 return {controller,port,writes,ack};
}
const note=(text:string)=>(doc:BrowserDocument)=>({...doc,drafts:{...doc.drafts,messages:{...doc.drafts.messages,one:text}}});

it('loads the whole document lazily and continues the confirmed input version without autosaving',async()=>{
 const initial={document:emptyBrowserDocument(),generation:3,revision:8,mutationRevision:4};initial.document.drafts.messages.one='原始草稿';
 const {controller,port,writes,ack}=fixture(initial);expect(port.load).not.toHaveBeenCalled();expect(controller.snapshot().loaded).toBe(false);
 await controller.start();expect(controller.snapshot()).toMatchObject({...initial,loaded:true,status:'saved',error:null});expect(port.save).not.toHaveBeenCalled();
 const saved=controller.change(note('新草稿'));expect(controller.snapshot().document.drafts.messages.one).toBe('新草稿');await tick();expect(writes[0].write.mutationRevision).toBe(5);ack(0);await saved;
});

it('serializes actual ACKs while retaining newer synchronous input and resolving each own save',async()=>{
 const {controller,writes,ack}=fixture();await controller.start();let firstDone=false,secondDone=false;
 const first=controller.change(note('first')).then(()=>{firstDone=true;});const second=controller.change(note('second')).then(()=>{secondDone=true;});
 expect(controller.snapshot()).toMatchObject({status:'saving',mutationRevision:6});expect(controller.snapshot().document.drafts.messages.one).toBe('second');await tick();expect(writes).toHaveLength(1);expect(firstDone).toBe(false);
 ack(0);await first;await tick();expect(secondDone).toBe(false);expect(writes).toHaveLength(2);expect(controller.snapshot().document.drafts.messages.one).toBe('second');ack(1);await second;expect(controller.snapshot().status).toBe('saved');
});

it('retains failed pending input and explicit flush retries its same input version',async()=>{
 const {controller,writes,ack}=fixture();await controller.start();const saved=controller.change(note('保留完整文字'));const failed=expect(saved).rejects.toThrow('disk full');await tick();writes[0].gate.reject(Error('disk full'));await failed;
 expect(controller.snapshot()).toMatchObject({status:'unsaved',error:'disk full',mutationRevision:5});expect(controller.snapshot().document.drafts.messages.one).toBe('保留完整文字');
 const retry=controller.flush();await tick();expect(writes[1].write).toEqual(writes[0].write);ack(1);await retry;expect(controller.snapshot()).toMatchObject({status:'saved',error:null});
});

it('merges only newer Node runtime fields without rolling back input on a late lower-revision ACK',async()=>{
 const {controller,ack}=fixture();await controller.start();const saved=controller.change(note('local'));await tick();
 const contexts={column:{lastInput:{profileId:'p',model:'m',inputTokens:12,throughId:null}}};
 controller.observeRuntime({generation:3,revision:12,usageRecords:[],contexts});controller.observeRuntime({generation:2,revision:99,usageRecords:[],contexts:{}});controller.observeRuntime({generation:3,revision:11,usageRecords:[],contexts:{}});
 ack(0);await saved;expect(controller.snapshot().revision).toBe(12);expect(controller.snapshot().document.state.contexts).toEqual(contexts);expect(controller.snapshot().document.drafts.messages.one).toBe('local');
});

it('locks export synchronously, flushes pending ACK first and never calls export after failed flush',async()=>{
 const {controller,port,writes,ack}=fixture();await controller.start();const changed=controller.change(note('pending'));await tick();const exported=controller.exportBackup();expect(controller.snapshot().status).toBe('locked');await expect(controller.change(note('forbidden'))).rejects.toThrow();expect(port.exportBackup).not.toHaveBeenCalled();ack(0);await changed;expect(await exported).toBe(true);expect(port.exportBackup).toHaveBeenCalledWith(3);
 const pending=controller.change(note('unwritten'));const failed=expect(pending).rejects.toThrow('EIO');await tick();writes[1].gate.reject(Error('EIO'));await failed;
 const exportFailure=expect(controller.exportBackup()).rejects.toThrow('retry EIO');await tick();writes[2].gate.reject(Error('retry EIO'));await exportFailure;expect(port.exportBackup).toHaveBeenCalledTimes(1);expect(controller.snapshot().status).toBe('unsaved');
});

it('cancelled or failed import keeps drafts and generation; successful import replaces all drafts and retires old generation',async()=>{
 const {controller,port}=fixture();await controller.start();const before=controller.snapshot().document;
 expect(await controller.importBackup()).toBe(false);expect(controller.snapshot().document).toEqual(before);expect(controller.snapshot().generation).toBe(3);
 vi.mocked(port.importBackup).mockRejectedValueOnce(Error('restore failed'));await expect(controller.importBackup()).rejects.toThrow('restore failed');expect(controller.snapshot().document).toEqual(before);
 const restored=emptyBrowserDocument();restored.drafts.messages.restored='导入原文';vi.mocked(port.importBackup).mockResolvedValueOnce({document:restored,generation:4,revision:10,mutationRevision:0});expect(await controller.importBackup()).toBe(true);expect(controller.snapshot()).toMatchObject({document:restored,generation:4,mutationRevision:0,status:'saved'});await expect(controller.change(note('stale'),{generation:3})).rejects.toThrow();
});

it('keeps the quit barrier until matching cancellation and coalesces the same token',async()=>{
 const {controller,ack}=fixture();await controller.start();const saving=controller.change(note('quit draft'));await tick();const quit=controller.prepareQuit('one');expect(controller.prepareQuit('one')).toBe(quit);expect(controller.snapshot().status).toBe('locked');controller.cancelQuit('old');expect(controller.snapshot().status).toBe('locked');ack(0);await saving;await quit;expect(controller.snapshot().status).toBe('locked');controller.cancelQuit('one');expect(controller.snapshot().status).toBe('saved');
});

it('close invalidates late callbacks without declaring outstanding input persisted',async()=>{
 const {controller,ack}=fixture();await controller.start();const saving=controller.change(note('not acknowledged'));const failed=expect(saving).rejects.toThrow();await tick();controller.close();ack(0);await failed;expect(controller.snapshot().status).not.toBe('saved');expect(controller.snapshot().document.drafts.messages.one).toBe('not acknowledged');await expect(controller.change(note('closed'))).rejects.toThrow();
});

it('rejects mismatched ACKs and never confirms the input on their behalf',async()=>{
 const {controller,ack}=fixture();await controller.start();const saved=controller.change(note('candidate'));const failed=expect(saved).rejects.toThrow();await tick();ack(0,{mutationRevision:99});await failed;expect(controller.snapshot().status).toBe('unsaved');
});

it('enqueues before publishing so a subscriber cannot reverse input write order',async()=>{
 const {controller,writes,ack}=fixture();await controller.start();let nested:Promise<void>|undefined;
 const unsubscribe=controller.subscribe(()=>{if(controller.snapshot().mutationRevision===5&&!nested)nested=controller.change(note('subscriber'));});
 const first=controller.change(note('outer'));await tick();expect(writes[0].write.document.drafts.messages.one).toBe('outer');ack(0);await first;await tick();expect(writes[1].write.document.drafts.messages.one).toBe('subscriber');ack(1);await nested;unsubscribe();
});
