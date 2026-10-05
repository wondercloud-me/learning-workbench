import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,readFile,readdir,rename,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {openDesktopStore} from '../src/node/desktop-store';
import {emptyBrowserDocument,type BrowserDocument} from '../src/core/browser-state';
import {readBackup} from '../src/core/backup';
import {usageRecord} from '../src/core/usage';

const folders:string[]=[];const now='2026-10-05T00:00:00.000Z';
afterEach(async()=>{await Promise.all(folders.splice(0).map(folder=>rm(folder,{recursive:true,force:true})));});
async function paths(){const dir=await mkdtemp(path.join(os.tmpdir(),'workbench-document-test-'));folders.push(dir);return {file:path.join(dir,'document-v1.json'),legacyFile:path.join(dir,'state.json'),appVersion:'0.10.0'};}
function fixture(text='自己的解释，输入在函数里加工后返回。'):BrowserDocument {
 const d=emptyBrowserDocument();d.drafts={lab:{'functions:practice':{explanation:text,lastRun:{code:'function greeting() { throw Error("自己的报错"); }',taskId:'greeting',error:'自己的报错',logs:['保留自己的日志'],checks:[]},updatedAt:now}},messages:{column:'  未发送的原文\n'},references:{column:{url:'https://example.com/source',text:'参考原文',providedAt:now}}};return d;
}
function gate(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
const record=()=>usageRecord('p','m','chat',{inputTokens:1,cachedInputTokens:0,uncachedInputTokens:1,cacheWriteTokens:null,outputTokens:1},now,'usage');

describe('desktop committed document queue',()=>{
 it('migrates into canonical only on commit and restarts with every draft intact',async()=>{
  const options=await paths();const legacy=JSON.stringify(emptyBrowserDocument().state);await writeFile(options.legacyFile,legacy);
  const store=await openDesktopStore(options);expect(store.snapshot()).toMatchObject({generation:0,revision:0,mutationRevision:0});expect(await readdir(path.dirname(options.file))).toEqual(['state.json']);
  const saved=await store.save({document:fixture(),generation:0,mutationRevision:1});expect(saved.document.drafts.lab['functions:practice'].lastRun!.logs).toEqual(['保留自己的日志']);
  expect(await readFile(options.legacyFile,'utf8')).toBe(legacy);expect(JSON.parse(await readFile(options.file,'utf8'))).toMatchObject({format:'growth-workbench',schemaVersion:1});
  expect((await openDesktopStore(options)).snapshot().document).toEqual(fixture());
 });
 it('does not acknowledge or expose a delayed candidate before the real file write',async()=>{
  const options=await paths();const blocked=gate();const started=gate();const store=await openDesktopStore({...options,write:async(file,text)=>{started.resolve();await blocked.promise;await writeFile(file,text);}});
  const input=fixture();let done=false;const pending=store.save({document:input,generation:0,mutationRevision:1}).then(value=>{done=true;return value;});input.drafts.messages.column='之后改动';
  await started.promise;expect(done).toBe(false);expect(store.snapshot().document.drafts.lab).toEqual({});blocked.resolve();
  const result=await pending;expect(result).toMatchObject({generation:0,revision:1,mutationRevision:1});expect(result.document.drafts.messages.column).toBe('  未发送的原文\n');
  result.document.drafts.messages.column='改返回副本';expect(store.snapshot().document.drafts.messages.column).toBe('  未发送的原文\n');
 });
 it('keeps committed bytes and flush failure through a real rename error until the save retry succeeds',async()=>{
  const options=await paths();const old=await openDesktopStore(options);await old.save({document:fixture('此前已确认的解释原文。'),generation:0,mutationRevision:1});const raw=await readFile(options.file,'utf8');let failing=true;
  const store=await openDesktopStore({...options,write:async(file,text)=>{const temp=`${file}.owned-test`;await writeFile(temp,text);await rename(temp,failing?path.join(file,'impossible'):file);}});
  await expect(store.save({document:fixture(),generation:0,mutationRevision:1})).rejects.toThrow();await expect(store.flush()).rejects.toThrow();expect(await readFile(options.file,'utf8')).toBe(raw);expect(store.snapshot()).toMatchObject({revision:0,mutationRevision:0});
  failing=false;await store.save({document:fixture(),generation:0,mutationRevision:1});await store.flush();expect(store.snapshot().document.drafts.lab['functions:practice'].explanation).toBe('自己的解释，输入在函数里加工后返回。');
 });
 it('does not confirm a real write error or erase it with an unrelated runtime success',async()=>{
  const options=await paths();let failing=true;const store=await openDesktopStore({...options,write:(file,text)=>writeFile(failing?path.join(file,'missing'):file,text)});
  await expect(store.save({document:fixture(),generation:0,mutationRevision:1})).rejects.toThrow();expect(store.snapshot().revision).toBe(0);failing=false;
  await store.runtime(0,current=>({...current,usageRecords:[record()]}));await expect(store.flush()).rejects.toThrow();expect(store.snapshot().mutationRevision).toBe(0);
  await store.save({document:fixture(),generation:0,mutationRevision:1});await store.flush();expect(store.snapshot().document.state.usageRecords[0].id).toBe('usage');
 });
 it('serializes runtime and renderer saves while keeping Node runtime authoritative',async()=>{
  const options=await paths();const store=await openDesktopStore(options);const producer=store.runtime(0,current=>({...current,usageRecords:[...current.usageRecords,record()],contexts:{c:{checkpoint:{summary:'主进程摘要',throughId:'m',createdAt:now}}}}));
  const saved=store.save({document:fixture(),generation:0,mutationRevision:1});expect(await producer).toMatchObject({generation:0,revision:1,usageRecords:[{id:'usage'}]});
  const next=await saved;expect(next).toMatchObject({revision:2,mutationRevision:1});expect(next.document.state.contexts.c.checkpoint!.summary).toBe('主进程摘要');expect(next.document.state.usageRecords).toHaveLength(1);
 });
 it('rejects stale mutation and generation writes without changing committed data',async()=>{
  const store=await openDesktopStore(await paths());await store.save({document:fixture(),generation:0,mutationRevision:2});const before=store.snapshot();
  await expect(store.save({document:fixture('陈旧解释不应覆盖。'),generation:0,mutationRevision:2})).rejects.toThrow(/版本|过期/);
  await expect(store.save({document:fixture(),generation:99,mutationRevision:3})).rejects.toThrow(/代次|过期/);await expect(store.runtime(99,current=>current)).rejects.toThrow(/代次|过期/);expect(store.snapshot()).toEqual(before);await store.flush();
 });
 it('validates again when duplicate mutations were admitted while an earlier save waited',async()=>{
  const options=await paths();const blocked=gate();const started=gate();const store=await openDesktopStore({...options,write:async(file,text)=>{started.resolve();await blocked.promise;await writeFile(file,text);}});
  const first=store.save({document:fixture(),generation:0,mutationRevision:1});await started.promise;const duplicate=store.save({document:fixture('陈旧候选的解释。'),generation:0,mutationRevision:1});const failure=expect(duplicate).rejects.toThrow(/版本|过期/);
  blocked.resolve();await first;await failure;expect(store.snapshot().document.drafts.lab['functions:practice'].explanation).toBe('自己的解释，输入在函数里加工后返回。');
 });
 it('does not commit malformed runtime records and can retry a valid producer',async()=>{
  const store=await openDesktopStore(await paths());await expect(store.runtime(0,current=>({...current,usageRecords:[{...record(),usage:{...record().usage!,inputTokens:-1}}]}))).rejects.toThrow();expect(store.snapshot().revision).toBe(0);await expect(store.flush()).rejects.toThrow();
  await store.runtime(0,current=>({...current,usageRecords:[record()]}));await store.flush();expect(store.snapshot().revision).toBe(1);
 });
 it('carries failed validated runtime A into producer B while preserving current learner state',async()=>{
  const options=await paths();let failing=true;const store=await openDesktopStore({...options,write:(file,text)=>writeFile(failing?path.join(file,'missing'):file,text)});
  const a={...record(),id:'runtime-a'},b={...record(),id:'runtime-b'};
  await expect(store.runtime(0,current=>({...current,usageRecords:[...current.usageRecords,a],contexts:{c:{checkpoint:{summary:'A 的摘要',throughId:'a',createdAt:now}},other:{checkpoint:{summary:'A 的另一份上下文',throughId:'a-other',createdAt:now}}}}))).rejects.toThrow();
  expect(store.snapshot().document.state.usageRecords).toEqual([]);failing=false;const learner=fixture();learner.state.checkins=[{date:'2026-10-05',columnId:'x',note:'runtime 失败后的新学习状态'}];
  await store.save({document:learner,generation:0,mutationRevision:1});expect(store.snapshot().document.state.usageRecords).toEqual([]);await expect(store.flush()).rejects.toThrow();
  await expect(store.runtime(0,current=>({...current,usageRecords:[{...record(),usage:{...record().usage!,inputTokens:-1}}],contexts:{}}))).rejects.toThrow();
  const result=await store.runtime(0,current=>{
   expect(current.checkins[0].note).toBe('runtime 失败后的新学习状态');expect(current.contexts.c?.checkpoint?.throughId).toBe('a');
   return {...current,usageRecords:[...current.usageRecords,b],contexts:{...current.contexts,c:{checkpoint:{summary:'B 接续 A 的新摘要',throughId:'b',createdAt:now}}}};
  });
  expect(result.usageRecords.map(value=>value.id)).toEqual(['runtime-a','runtime-b']);await store.flush();
  const confirmed=readBackup(JSON.parse(await readFile(options.file,'utf8')));expect(confirmed.state.usageRecords.map(value=>value.id)).toEqual(['runtime-a','runtime-b']);expect(confirmed.state.contexts.c.checkpoint!.summary).toBe('B 接续 A 的新摘要');expect(confirmed.state.contexts.other.checkpoint!.throughId).toBe('a-other');expect(confirmed.state.checkins).toEqual(learner.state.checkins);expect(store.snapshot()).toMatchObject({revision:2,mutationRevision:1});
 });
});

describe('desktop export and restore barriers',()=>{
 it('drains admitted writes before exporting exactly their document and rejects new admission',async()=>{
  const options=await paths();const blocked=gate();const started=gate();const writer=gate();const store=await openDesktopStore({...options,write:async(file,text)=>{started.resolve();await blocked.promise;await writeFile(file,text);}});
  const saving=store.save({document:fixture(),generation:0,mutationRevision:1});await started.promise;const runtime=store.runtime(0,current=>({...current,usageRecords:[record()]}));
  let exported:unknown;const writerStarted=gate();const exporting=store.export(0,async backup=>{exported=backup;writerStarted.resolve();await writer.promise;return true;});
  await expect(store.save({document:fixture(),generation:0,mutationRevision:2})).rejects.toThrow(/正在|锁/);await expect(store.runtime(0,current=>current)).rejects.toThrow(/正在|锁/);await expect(store.restore(0,async()=>null)).rejects.toThrow(/正在|锁/);
  blocked.resolve();await saving;await runtime;await writerStarted.promise;expect(readBackup(exported).drafts).toEqual(fixture().drafts);expect(readBackup(exported).state.usageRecords[0].id).toBe('usage');writer.resolve();expect(await exporting).toBe(true);await store.save({document:fixture(),generation:0,mutationRevision:2});
 });
 it('replaces after prior admitted commits, resets renderer revision and rejects late old-generation producers',async()=>{
  const options=await paths();const blocked=gate();const started=gate();const store=await openDesktopStore({...options,write:async(file,text)=>{started.resolve();await blocked.promise;await writeFile(file,text);}});
  const saving=store.save({document:fixture('替换前的解释原文。'),generation:0,mutationRevision:4});await started.promise;const restoring=store.restore(0,async()=>fixture('从备份完整恢复的解释。'));blocked.resolve();await saving;const restored=await restoring;
  expect(restored).toMatchObject({generation:1,revision:2,mutationRevision:0});expect(restored!.document.drafts.lab['functions:practice'].explanation).toBe('从备份完整恢复的解释。');
  let called=false;await expect(store.runtime(0,current=>{called=true;return current;})).rejects.toThrow(/代次|过期/);expect(called).toBe(false);await expect(store.save({document:fixture(),generation:0,mutationRevision:5})).rejects.toThrow(/代次|过期/);
  await store.save({document:fixture('恢复后的新解释。'),generation:1,mutationRevision:1});expect(store.snapshot().revision).toBe(3);
 });
 it.each(['cancel','reader-error'] as const)('keeps document and generation on restore %s and releases its lock',async mode=>{
  const store=await openDesktopStore(await paths());await store.save({document:fixture(),generation:0,mutationRevision:1});const before=store.snapshot();const read=gate();
  const pending=store.restore(0,async()=>{await read.promise;if(mode==='reader-error')throw Error('未来备份拒绝');return null;});await expect(store.save({document:fixture(),generation:0,mutationRevision:2})).rejects.toThrow(/正在|锁/);read.resolve();
  if(mode==='cancel')expect(await pending).toBeNull();else await expect(pending).rejects.toThrow('未来备份拒绝');expect(store.snapshot()).toEqual(before);await store.save({document:fixture(),generation:0,mutationRevision:2});
 });
 it('leaves old bytes and generation intact when restoration cannot write',async()=>{
  const options=await paths();let fail=false;const store=await openDesktopStore({...options,write:(file,text)=>writeFile(fail?path.join(file,'missing'):file,text)});await store.save({document:fixture(),generation:0,mutationRevision:1});const raw=await readFile(options.file,'utf8');const before=store.snapshot();fail=true;
  await expect(store.restore(0,async()=>fixture('未能落盘的恢复候选。'))).rejects.toThrow();expect(store.snapshot()).toEqual(before);expect(await readFile(options.file,'utf8')).toBe(raw);await store.flush();
  expect(await store.export(0,async backup=>{expect(readBackup(backup)).toEqual(before.document);return true;})).toBe(true);
  fail=false;await store.restore(0,async()=>fixture('重试后的恢复候选。'));await store.flush();expect(store.snapshot().generation).toBe(1);
 });
 it('does not export when an admitted write failed and releases locks on writer error',async()=>{
  const options=await paths();let failing=true;const store=await openDesktopStore({...options,write:(file,text)=>writeFile(failing?path.join(file,'missing'):file,text)});await expect(store.save({document:fixture(),generation:0,mutationRevision:1})).rejects.toThrow();let exported=false;
  await expect(store.export(0,async()=>{exported=true;return true;})).rejects.toThrow();expect(exported).toBe(false);failing=false;await store.save({document:fixture(),generation:0,mutationRevision:1});
  await expect(store.export(0,async()=>{throw Error('导出目标不可写');})).rejects.toThrow('导出目标不可写');await store.save({document:fixture(),generation:0,mutationRevision:2});
 });
});
