import {afterEach, expect, it, vi} from 'vitest';
import {IDBFactory, IDBObjectStore} from 'fake-indexeddb';
import {openBrowserRepository, BrowserStorageError, type BrowserRepository} from '../src/browser/repository';
import {createBrowserController, type BrowserController} from '../src/browser/controller';
import {beginLab, setLabCode, saveLabAttempt, type LabRun} from '../src/core/lab';
import {createBackup, readBackup} from '../src/core/backup';

const controllers: BrowserController[] = [];
const repos: BrowserRepository[] = [];
afterEach(() => {vi.restoreAllMocks(); controllers.splice(0).forEach(c => c.close()); repos.splice(0).forEach(r => r.close());});
async function setup(factory = new IDBFactory(), wrap?: (r: BrowserRepository) => BrowserRepository) {
 const r = await openBrowserRepository(factory, () => '2026-10-05T10:00:00.000Z'); repos.push(r);
 const c = await createBrowserController(wrap ? wrap(r) : r); controllers.push(c); return {r, c};
}
const message = (text: string) => (d: ReturnType<BrowserController['pendingDocument']>) => ({...d, drafts: {...d.drafts, messages: {...d.drafts.messages, main: text}}});
function deferred() {let resolve!: () => void; const promise = new Promise<void>(done => {resolve = done;}); return {promise, resolve};}

it('retainsOptimisticInputOnQuotaFailure and retries the entire pending candidate', async () => {
 const {r,c} = await setup(); const put = IDBObjectStore.prototype.put;
 const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, ...args: Parameters<typeof put>) {if (this.name === 'document') throw new DOMException('full', 'QuotaExceededError'); return put.apply(this,args);});
 const save = c.change(message('my unsaved answer'));
 expect(c.pendingDocument().drafts.messages.main).toBe('my unsaved answer'); expect(c.snapshot().revision).toBe(0);
 await expect(save).rejects.toMatchObject({code:'quota'}); expect(c.storageStatus()).toBe('unsaved'); expect(c.hasPending()).toBe(true);
 await expect(c.flush()).rejects.toMatchObject({code:'quota'});
 spy.mockRestore(); await c.change(d=>d); await c.flush();
 expect((await r.load()).document.drafts.messages.main).toBe('my unsaved answer'); expect(c.hasPending()).toBe(false);
});
it('serializesLabAndDraftChangesWithoutLosingFields or newer optimistic edits', async () => {
 const gate = deferred(); let first = true;
 const {r,c} = await setup(undefined, repository => ({...repository, commit: async (d,rev) => {if (first) {first=false; await gate.promise;} return repository.commit(d,rev);}}));
 const one = c.change(d=>({...d, state:{...d.state, lab:setLabCode(beginLab(d.state.lab,'functions','practice','2026-10-05T10:00:00.000Z'),'functions','practice','return name;')}}));
 const two = c.change(message('new explanation'));
 expect(c.pendingDocument().drafts.messages.main).toBe('new explanation'); expect(c.snapshot().revision).toBe(0);
 gate.resolve(); await one; expect(c.pendingDocument().drafts.messages.main).toBe('new explanation'); await two;
 expect((await r.load()).document).toMatchObject({state:{lab:{sessions:{'functions:practice':{code:'return name;'}}}}, drafts:{messages:{main:'new explanation'}}});
 expect(c.snapshot().revision).toBe(2); expect(c.storageStatus()).toBe('saved');
});
it('blocksReplaceDuringOperation and during a queued save', async () => {
 const {c} = await setup(); const gate = deferred();
 const operation = c.withOperation('lab',()=>gate.promise); expect(c.isBusy()).toBe(true);
 await expect(c.replace(c.pendingDocument())).rejects.toMatchObject({code:'unavailable'});
 await c.change(message('operation may save result')); gate.resolve(); await operation;
 await c.replace(c.pendingDocument()); expect(c.snapshot().revision).toBe(2);
});
it('initialReadFailureDoesNotCreateEmptyReplacement', async () => {
 const {r} = await setup(); await r.commit({... (await r.load()).document, drafts:{lab:{}, references:{}, messages:{main:'original'}}},0);
 const broken = {...r, load: async () => {throw new BrowserStorageError('unavailable','read failed');}};
 await expect(createBrowserController(broken)).rejects.toMatchObject({code:'unavailable'});
 expect((await r.load()).document.drafts.messages.main).toBe('original');
});
it('freezes conflicted pending edits until explicit reloadLatest', async () => {
 const factory = new IDBFactory(); const {r,c} = await setup(factory); const other = await openBrowserRepository(factory); repos.push(other);
 const gate = deferred(); const originalCommit = r.commit; r.commit = async (d,rev)=>{await gate.promise; return originalCommit(d,rev);};
 const pending = c.change(message('local candidate')); await other.commit(message('other tab')((await other.load()).document),0);
 gate.resolve(); await expect(pending).rejects.toMatchObject({code:'revision-conflict'});
 expect(c.pendingDocument().drafts.messages.main).toBe('local candidate');
 await expect(c.change(d=>d)).rejects.toMatchObject({code:'revision-conflict'});
 await c.reloadLatest(); expect(c.pendingDocument().drafts.messages.main).toBe('other tab'); expect(c.hasPending()).toBe(false);
});
it('follows newer revisions when no local input is pending', async () => {
 const factory = new IDBFactory(); const {c} = await setup(factory); const other = await openBrowserRepository(factory); repos.push(other);
 await other.commit(message('new remote')((await other.load()).document),0);
 await vi.waitFor(()=>expect(c.pendingDocument().drafts.messages.main).toBe('new remote'));
 expect(c.storageStatus()).toBe('saved');
});
it('acquires a synchronous update barrier and releases it idempotently', async () => {
 const {c} = await setup(); let notifications=0; c.subscribe(()=>notifications++);
 const release = c.acquireUpdateLock(); expect(c.isBusy()).toBe(true); await c.flush();
 await expect(c.change(message('blocked'))).rejects.toMatchObject({code:'unavailable'});
 await expect(c.replace(c.pendingDocument())).rejects.toMatchObject({code:'unavailable'});
 await expect(c.reloadLatest()).rejects.toMatchObject({code:'unavailable'});
 await expect(c.withOperation('model',async()=>1)).rejects.toMatchObject({code:'unavailable'});
 release(); release(); expect(c.isBusy()).toBe(false); expect(notifications).toBe(2);
 await c.change(message('after update')); expect(c.snapshot().document.drafts.messages.main).toBe('after update');
});
it('refuses update lock while a save or unsaved draft exists', async () => {
 const gate=deferred(); const {c}=await setup(undefined, r=>({...r,commit:async()=>{await gate.promise; throw new BrowserStorageError('quota','full');}}));
 const pending=c.change(message('pending')); expect(()=>c.acquireUpdateLock()).toThrow();
 gate.resolve(); await expect(pending).rejects.toMatchObject({code:'quota'}); expect(()=>c.acquireUpdateLock()).toThrow();
});
it('returns detached snapshots so external mutation cannot bypass saving', async () => {
 const {c,r}=await setup(); c.pendingDocument().drafts.messages.main='bypass'; c.snapshot().document.drafts.messages.main='bypass';
 expect(c.pendingDocument().drafts.messages.main).toBeUndefined(); expect((await r.load()).document.drafts.messages.main).toBeUndefined();
});
it('preserves newest input when a subscriber submits another change synchronously', async () => {
 const {c,r}=await setup(); let nested: Promise<unknown> | undefined;
 const unsubscribe=c.subscribe(()=>{if(c.pendingDocument().drafts.messages.main==='first' && !nested) nested=c.change(message('second'));});
 const first=c.change(message('first')); await first; await nested; unsubscribe();
 expect(c.pendingDocument().drafts.messages.main).toBe('second'); expect((await r.load()).document.drafts.messages.main).toBe('second'); expect(c.hasPending()).toBe(false);
});
it('allows an explicit replacement retry after recovery quota fails', async () => {
 const {c}=await setup(); await c.change(message('original')); const put=IDBObjectStore.prototype.put;
 const spy=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args:Parameters<typeof put>){if(this.name==='recovery')throw new DOMException('full','QuotaExceededError');return put.apply(this,args);});
 await expect(c.replace(message('restored')(c.pendingDocument()))).rejects.toMatchObject({code:'quota'});
 expect(c.snapshot().document.drafts.messages.main).toBe('original'); spy.mockRestore();
 await c.replace(message('restored')(c.pendingDocument())); expect(c.snapshot().document.drafts.messages.main).toBe('restored');
});
it('retains a failed optimistic lab attempt exactly once across an identity retry', async () => {
 const {c,r}=await setup(); const now='2026-10-05T10:00:00.000Z';
 await c.change(d=>({...d,state:{...d.state,lab:setLabCode(beginLab(d.state.lab,'functions','practice',now),'functions','practice','return name;')}}));
 const run:LabRun={code:'return name;',taskId:'greeting',checks:[],logs:[],error:'not passed'};
 const put=IDBObjectStore.prototype.put;
 const spy=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args:Parameters<typeof put>){if(this.name==='document')throw new DOMException('full','QuotaExceededError');return put.apply(this,args);});
 await expect(c.change(d=>({...d,state:{...d.state,lab:saveLabAttempt(d.state.lab,'functions','practice',run,'我尝试返回传入的名字',now)}}))).rejects.toMatchObject({code:'quota'});
 expect(c.snapshot().document.state.lab.attempts).toHaveLength(0); expect(c.pendingDocument().state.lab.attempts).toHaveLength(1);
 const attemptId=c.pendingDocument().state.lab.attempts[0].id;
 await expect(c.replace(c.snapshot().document)).rejects.toMatchObject({code:'unavailable'});
 spy.mockRestore(); await c.change(d=>d);
 expect((await r.load()).document.state.lab.attempts.map(a=>a.id)).toEqual([attemptId]);
});
it('rejects invalid edits without mutating the previous pending content', async () => {
 const {c}=await setup(); await c.change(message('valid learner content'));
 await expect(c.change(d=>{d.drafts.messages.main='x'.repeat(20001);return d;})).rejects.toMatchObject({code:'invalid'});
 expect(c.pendingDocument().drafts.messages.main).toBe('valid learner content'); expect(c.hasPending()).toBe(false);
});
it('releases repository subscriptions and refuses edits after close', async () => {
 const factory=new IDBFactory(); const {c}=await setup(factory); let notifications=0; c.subscribe(()=>notifications++); c.close(); c.close();
 const other=await openBrowserRepository(factory); repos.push(other); await other.commit(message('new')((await other.load()).document),0);
 expect(notifications).toBe(0); await expect(c.change(message('closed'))).rejects.toMatchObject({code:'unavailable'});
});
it.each([false,true])('retains terminal invalidation after an active write succeeds (newer pending input: %s)', async (withNewerInput) => {
 const factory=new IDBFactory(); const {c,r}=await setup(factory); const events:string[]=[]; c.subscribe(()=>events.push(c.storageStatus()));
 const put=IDBObjectStore.prototype.put; let upgrade:Promise<void>|undefined; let triggered=false;
 vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args:Parameters<typeof put>){
  const request=put.apply(this,args);
  if(this.name==='document'&&!triggered){triggered=true; request.addEventListener('success',()=>{
   const opening=factory.open('growth-workbench',2); upgrade=new Promise<void>((resolve,reject)=>{opening.onsuccess=()=>{opening.result.close();resolve();};opening.onerror=()=>reject(opening.error);});
   const keepAlive=()=>{const reading=this.get('current'); reading.onsuccess=()=>{if(c.storageStatus()!=='unavailable')keepAlive();};}; keepAlive();
  });}
  return request;
 });
 const first=c.change(message('transaction completed'));
 const failure=withNewerInput?expect(c.change(message('newer unsaved input'))).rejects.toMatchObject({code:'unavailable'}):Promise.resolve();
 await first; await failure; await upgrade;
 expect(c.snapshot()).toMatchObject({revision:1,document:{drafts:{messages:{main:'transaction completed'}}}});
 expect(c.pendingDocument().drafts.messages.main).toBe(withNewerInput?'newer unsaved input':'transaction completed'); expect(c.hasPending()).toBe(withNewerInput);
 expect(c.storageStatus()).toBe('unavailable'); expect(events).toContain('unavailable'); expect(events.slice(events.indexOf('unavailable'))).not.toContain('saved');
 await expect(r.load()).rejects.toMatchObject({code:'unavailable'}); await expect(r.flush()).rejects.toMatchObject({code:'unavailable'}); await expect(c.flush()).rejects.toMatchObject({code:'unavailable'});
 expect(()=>c.acquireUpdateLock()).toThrow();
});
it('keeps invalidation terminal through delayed reload and replacement successes', async () => {
 for(const action of ['reload','replace'] as const){
  let invalidate:((revision:number)=>void)|undefined; let delay=false; const gate=deferred(); const {c}=await setup(undefined,r=>({...r,subscribe:listener=>{invalidate=listener;return ()=>{};},load:async()=>{const value=await r.load(); if(delay)await gate.promise;return value;},replace:async(d,rev)=>{const value=await r.replace(d,rev);await gate.promise;return value;}}));
  delay=true;
  const task=action==='reload'?c.reloadLatest():c.replace(message('restored')(c.pendingDocument()));
  invalidate!(-1); gate.resolve(); await task;
  expect(c.storageStatus()).toBe('unavailable'); await expect(c.flush()).rejects.toMatchObject({code:'unavailable'}); expect(()=>c.acquireUpdateLock()).toThrow();
 }
});
it('rejects initialization invalidated between its first read and listener registration', async () => {
 const r=await openBrowserRepository(new IDBFactory()); repos.push(r); let listener:((revision:number)=>void)|undefined;
 const wrapper={...r,subscribe:(next:(revision:number)=>void)=>{listener=next; return ()=>{};},load:async()=>{const snapshot=await r.load();listener?.(-1);return snapshot;}};
 await expect(createBrowserController(wrapper)).rejects.toMatchObject({code:'unavailable'});
});
it('stages ongoing code after a real revision conflict for complete pending export without overwriting remote data', async () => {
 const factory=new IDBFactory(); const {c,r}=await setup(factory); const now='2026-10-05T10:00:00.000Z';
 const code=(text:string)=>(d:ReturnType<BrowserController['pendingDocument']>)=>({...d,state:{...d.state,lab:setLabCode(beginLab(d.state.lab,'functions','practice',now),'functions','practice',text)}});
 await c.change(code('return name;')); const originalSnapshot=c.snapshot();
 const other=await openBrowserRepository(factory);repos.push(other);const gate=deferred();const commit=r.commit;r.commit=async(d,revision)=>{await gate.promise;return commit(d,revision);};
 const initial=c.change(code('return name;\n// local first edit'));
 await other.commit(code('return "remote";')((await other.load()).document),1);
 expect(c.storageStatus()).toBe('conflict');const observed:string[]=[];c.subscribe(()=>observed.push(c.pendingDocument().state.lab.sessions['functions:practice'].code));
 const text='return name;\n// local first edit\n// KEEP THIS INPUT';
 const rejected=c.change(code(text));
 const stagedImmediately=c.pendingDocument().state.lab.sessions['functions:practice'].code;
 await expect(rejected).rejects.toMatchObject({code:'revision-conflict'});gate.resolve();await expect(initial).rejects.toMatchObject({code:'revision-conflict'});
 expect(stagedImmediately).toBe(text);expect(observed).toContain(text);
 expect(c.snapshot()).toEqual(originalSnapshot);expect(c.hasPending()).toBe(true);expect(c.storageStatus()).toBe('conflict');
 expect(readBackup(createBackup(c.pendingDocument(),'0.9.0',now)).state.lab.sessions['functions:practice'].code).toBe(text);
 expect(await other.load()).toMatchObject({revision:2,document:{state:{lab:{sessions:{'functions:practice':{code:'return "remote";'}}}}}});
});
it('stages ongoing code after real repository versionchange for export while terminal actions reject', async () => {
 const factory=new IDBFactory();const {c}=await setup(factory);const now='2026-10-05T10:00:00.000Z';
 await c.change(d=>({...d,state:{...d.state,lab:setLabCode(beginLab(d.state.lab,'functions','practice',now),'functions','practice','return name;')}}));const saved=c.snapshot();
 const request=factory.open('growth-workbench',2);const db=await new Promise<IDBDatabase>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
 expect(c.storageStatus()).toBe('unavailable');let emitted=0;c.subscribe(()=>emitted++);
 const text='return name;\n// KEEP INPUT AFTER UPGRADE';
 const rejected=c.change(d=>({...d,state:{...d.state,lab:setLabCode(d.state.lab,'functions','practice',text)}}));
 const stagedImmediately=c.pendingDocument().state.lab.sessions['functions:practice'].code;
 await expect(rejected).rejects.toMatchObject({code:'unavailable'});
 const tx=db.transaction('document','readonly');const stored=tx.objectStore('document').get('current');const unchanged=await new Promise<unknown>(resolve=>{stored.onsuccess=()=>resolve(stored.result);});db.close();
 expect(stagedImmediately).toBe(text);expect(emitted).toBe(1);expect(c.snapshot()).toEqual(saved);expect(c.hasPending()).toBe(true);expect(c.storageStatus()).toBe('unavailable');
 expect(readBackup(createBackup(c.pendingDocument(),'0.9.0',now)).state.lab.sessions['functions:practice'].code).toBe(text);
 await expect(c.withOperation('lab',async()=>1)).rejects.toMatchObject({code:'unavailable'});await expect(c.replace(saved.document)).rejects.toMatchObject({code:'unavailable'});expect(()=>c.acquireUpdateLock()).toThrow();
 expect(unchanged).toEqual(saved);
});
it('does not stage edits while explicitly closed or under exclusive and update barriers', async () => {
 const {c}=await setup();const release=c.acquireUpdateLock();await expect(c.change(message('blocked update'))).rejects.toMatchObject({code:'unavailable'});expect(c.hasPending()).toBe(false);expect(c.pendingDocument().drafts.messages.main).toBeUndefined();release();
 const reload=c.reloadLatest();await expect(c.change(message('blocked reload'))).rejects.toMatchObject({code:'unavailable'});await reload;expect(c.hasPending()).toBe(false);expect(c.pendingDocument().drafts.messages.main).toBeUndefined();
 c.close();await expect(c.change(message('blocked close'))).rejects.toMatchObject({code:'unavailable'});expect(c.hasPending()).toBe(false);expect(c.pendingDocument().drafts.messages.main).toBeUndefined();
});
