import {afterEach,expect,it,vi} from 'vitest';
import {IDBFactory} from 'fake-indexeddb';
import {createBrowserController,type BrowserController} from '../src/browser/controller';
import {openBrowserRepository,BrowserStorageError,type BrowserRepository} from '../src/browser/repository';
import {createColumn} from '../src/core/learning';
import {createSideChat} from '../src/core/sidechat';
import {createBackup} from '../src/core/backup';
import type {ContextTurn} from '../src/core/context-cache';

const now='2026-10-05T10:00:00.000Z';
const profile={id:'p',name:'P',baseUrl:'https://models.example/v1',protocol:'responses' as const,models:['m'],contextWindows:{m:1000}};
const library=()=>({profiles:[structuredClone(profile)],active:{profileId:'p',model:'m'}});
const history:ContextTurn[]=Array.from({length:12},(_,i)=>({id:`h${i}`,role:i%2?'assistant':'user',content:`raw ${i}`}));
const response=(text='reply',input=80)=>new Response(JSON.stringify({output_text:text,usage:{input_tokens:input,output_tokens:10}}));
const controllers:BrowserController[]=[];const repositories:BrowserRepository[]=[];
afterEach(()=>{vi.restoreAllMocks();controllers.splice(0).forEach(c=>c.close());repositories.splice(0).forEach(r=>r.close());});
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
async function setup(fetcher:typeof fetch,factory=new IDBFactory()){
 const p=await import('../src/browser/model-port').catch(()=>undefined);const m=await import('../src/core/model-session').catch(()=>undefined);
 expect(p?.BrowserModelPort,'browser port implemented').toBeTypeOf('function');expect(m?.createModelSession,'shared model session implemented').toBeTypeOf('function');
 const r=await openBrowserRepository(factory,()=>now);repositories.push(r);const c=await createBrowserController(r);controllers.push(c);
 await c.change(d=>({...d,state:{...d.state,columns:[createColumn('one','goal',now,'c'),createColumn('two','goal',now,'d')]},drafts:{...d.drafts,messages:{c:'unsent draft'}}}));
 const port=new p!.BrowserModelPort(fetcher);port.setKey(profile,'private-key');const session=m!.createModelSession(port,c);
 const input={scope:'c',columnId:'c',system:'system',task:'explicit action',turns:structuredClone(history),library:library(),purpose:'chat' as const,requestId:'r1'};
 return {r,c,port,session,input,factory};
}
it('staleUiSaveCannotOverwriteUsageAndSummary with field-local latest merges',async()=>{
 const gate=deferred<Response>();let dispatched=0;const {c,session,input}=await setup(async()=>{dispatched++;return dispatched===1?gate.promise:response();});
 await c.change(d=>({...d,state:{...d.state,contexts:{c:{lastInput:{profileId:'p',model:'m',inputTokens:850,throughId:null}}}}}));
 const pending=session.chat(input);await vi.waitFor(()=>expect(dispatched).toBe(1));
 await c.change(d=>({...d,drafts:{...d.drafts,messages:{...d.drafts.messages,c:'edited while paying'}}}));gate.resolve(response('summary'));expect(await pending).toBe('reply');
 await c.change(d=>({...d,state:{...d.state,reading:{...d.state.reading,title:'local UI field'}}}));
 const doc=c.pendingDocument();expect(doc.state.contexts.c.checkpoint).toMatchObject({summary:'summary',throughId:'h3'});expect(doc.state.usageRecords.map(r=>r.purpose)).toEqual(['summary','chat']);
 expect(new Set(doc.state.usageRecords.map(r=>r.id)).size).toBe(2);expect(doc.drafts.messages.c).toBe('edited while paying');expect(doc.state.columns[0].messages).toEqual([]);expect(doc.state.columns[0].evidence).toEqual([]);
 expect(await session.chat(input)).toBe('reply');expect(dispatched).toBe(2);expect(c.pendingDocument().state.usageRecords).toHaveLength(2);
});
it('textlessResponsePersistsReportedUsageOnce even when the same request is invoked again',async()=>{
 let posts=0;const {c,session,input}=await setup(async()=>{posts++;return response('');});
 await expect(session.chat(input)).rejects.toThrow('模型没有返回文本');await expect(session.chat(input)).rejects.toThrow('模型没有返回文本');
 expect(posts).toBe(1);expect(c.pendingDocument().state.usageRecords).toHaveLength(1);expect(c.pendingDocument().state.usageRecords[0].usage?.inputTokens).toBe(80);expect(c.pendingDocument().drafts.messages.c).toBe('unsent draft');
});
it('networkFailureKeepsDraftAndUsageUnknown without an automatic resend',async()=>{
 let posts=0;const {c,session,input}=await setup(async()=>{posts++;throw new TypeError('Failed to fetch');});
 await expect(session.chat(input)).rejects.toThrow('Failed to fetch');await expect(session.chat(input)).rejects.toThrow('Failed to fetch');expect(posts).toBe(1);
 expect(c.pendingDocument().state.usageRecords[0].usage).toBeNull();expect(c.pendingDocument().drafts.messages.c).toBe('unsent draft');expect(c.isBusy()).toBe(false);
});
it('restoreCannotCrossAnInFlightCompaction and guards queued invocations through their full lifetime',async()=>{
 const gate=deferred<Response>();let posts=0;const {c,session,input}=await setup(async()=>{posts++;return posts===1?gate.promise:response();});
 const pending=session.compact(input);const queued=session.chat({...input,requestId:'r2'});await vi.waitFor(()=>expect(posts).toBe(1));
 await expect(c.replace(c.pendingDocument())).rejects.toMatchObject({code:'unavailable'});await expect(c.reloadLatest()).rejects.toMatchObject({code:'unavailable'});expect(()=>c.acquireUpdateLock()).toThrow();
 gate.resolve(response('summary'));await pending;await queued;expect(posts).toBe(2);expect(c.isBusy()).toBe(false);
 await c.replace(c.pendingDocument());
});
it('reads latest context at scope queue start but holds accepted model, key, history and task fixed',async()=>{
 const gate=deferred<Response>();const payloads:any[]=[];const auth:string[]=[];
 const {c,port,session,input}=await setup(async(_url,init)=>{payloads.push(JSON.parse(init!.body as string));auth.push((init!.headers as Record<string,string>).authorization);return payloads.length===1?gate.promise:response();});
 const first=session.compact(input);const secondInput={...input,requestId:'second',turns:structuredClone(history),library:library()};const second=session.chat(secondInput);
 secondInput.task='mutated task';secondInput.turns[0].content='mutated history';secondInput.library.profiles[0].contextWindows.m=2000;port.setKey(profile,'changed-key');
 gate.resolve(response('fresh summary'));await first;await second;
 expect(payloads[1].input[0].content).toContain('fresh summary');expect(payloads[1].input.at(-1).content).toBe('explicit action');expect(auth).toEqual(['Bearer private-key','Bearer private-key']);expect(c.pendingDocument().state.contexts.c.checkpoint?.summary).toBe('fresh summary');
});
it('independent scopes may overlap, while repeated active requestId dispatches one POST',async()=>{
 const gates=[deferred<Response>(),deferred<Response>()];let posts=0;const {session,input}=await setup(async()=>gates[posts++].promise);
 const first=session.chat(input);const duplicate=session.chat(input);const other=session.chat({...input,scope:'d',columnId:'d',requestId:'other'});await vi.waitFor(()=>expect(posts).toBe(2));gates.forEach(g=>g.resolve(response()));
 expect(await Promise.all([first,duplicate,other])).toEqual(['reply','reply','reply']);expect(posts).toBe(2);
});
it('paid result survives quota failure in RAM and persistence retry never overwrites newer context',async()=>{
 let posts=0;const {r,c,session,input}=await setup(async()=>{posts++;return response(`reply ${posts}`);});const commit=r.commit;let fail=true;r.commit=async(d,rev)=>{if(fail)throw new BrowserStorageError('quota','full');return commit(d,rev);};
 await expect(session.chat(input)).rejects.toThrow('full');expect(posts).toBe(1);expect(c.pendingDocument().state.usageRecords).toHaveLength(1);expect(JSON.stringify(createBackup(c.pendingDocument(),'0.9.0',now))).not.toContain('private-key');
 fail=false;expect(await session.chat({...input,requestId:'newer'})).toBe('reply 2');const newer=c.pendingDocument().state.contexts.c;
 expect(await session.chat(input)).toBe('reply 1');expect(posts).toBe(2);expect(c.pendingDocument().state.contexts.c).toEqual(newer);expect(c.hasPending()).toBe(false);expect(c.pendingDocument().drafts.messages.c).toBe('unsent draft');
});
it('conflicted paid usage remains in pending backup and is never automatically resent',async()=>{
 const gate=deferred<Response>();let posts=0;const {c,session,input,factory}=await setup(async()=>{posts++;return gate.promise;});const other=await openBrowserRepository(factory,()=>now);repositories.push(other);
 const pending=session.chat(input);await vi.waitFor(()=>expect(posts).toBe(1));const remote=await other.load();await other.commit({...remote.document,drafts:{...remote.document.drafts,messages:{remote:'remote'}}},remote.revision);gate.resolve(response());
 await expect(pending).rejects.toMatchObject({code:'revision-conflict'});expect(c.pendingDocument().state.usageRecords).toHaveLength(1);await expect(session.chat(input)).rejects.toMatchObject({code:'revision-conflict'});expect(posts).toBe(1);
});
it('pre-aborted or queued cancellation never dispatches its POST; dispatched cancellation records unknown once',async()=>{
 let posts=0;const gate=deferred<Response>();const {c,session,input}=await setup(async(_url,init)=>{posts++;if(posts===1)return gate.promise;return await new Promise((_res,reject)=>init!.signal!.addEventListener('abort',()=>reject(new Error('canceled')),{once:true}));});
 const aborted=new AbortController();aborted.abort();await expect(session.chat(input,aborted.signal)).rejects.toThrow();expect(posts).toBe(0);
 const first=session.chat({...input,requestId:'first'});const queuedAbort=new AbortController();const queued=session.chat({...input,requestId:'queued'},queuedAbort.signal);queuedAbort.abort();gate.resolve(response());await first;await expect(queued).rejects.toThrow();expect(posts).toBe(1);
 const active=new AbortController();const paying=session.chat({...input,requestId:'paying'},active.signal);await vi.waitFor(()=>expect(posts).toBe(2));active.abort();await expect(paying).rejects.toThrow('canceled');expect(c.pendingDocument().state.usageRecords.at(-1)?.usage).toBeNull();expect(c.isBusy()).toBe(false);
});
it('requires existing selected scope and respects lifecycle guards on cached-result recovery',async()=>{
 let posts=0;const {c,port,session,input}=await setup(async()=>{posts++;return response();});
 await expect(session.chat({...input,columnId:'missing'})).rejects.toThrow();await expect(session.chat({...input,scope:'unknown'})).rejects.toThrow();await expect(session.chat({...input,purpose:'side'})).rejects.toThrow();expect(posts).toBe(0);
 await c.change(d=>({...d,state:{...d.state,sideChats:[createSideChat({id:'s',columnId:'c',parentMessageId:'h0',selectedText:'raw',sourceMessage:'raw 0',columnGoal:'goal',now})]}}));
 expect(await session.chat({...input,scope:'side:s',purpose:'side',requestId:'side'})).toBe('reply');expect(c.pendingDocument().state.usageRecords[0].purpose).toBe('side');
 await session.chat(input);const unlock=c.acquireUpdateLock();await expect(session.chat(input)).rejects.toThrow();unlock();session.clear();expect(port.hasKey(profile)).toBe(false);port.setKey(profile,'key');session.dispose();expect(port.hasKey(profile)).toBe(false);await expect(session.chat({...input,requestId:'after-dispose'})).rejects.toThrow();
});
it('dispose clears keys immediately during paid work and prevents a queued POST',async()=>{
 const gate=deferred<void>();let posts=0;const {c,port,session,input}=await setup(async()=>{posts++;await gate.promise;return response();});
 const paying=session.chat(input);const queued=session.chat({...input,requestId:'queued'}).then(value=>({value}),error=>({error}));await vi.waitFor(()=>expect(posts).toBe(1));
 expect(()=>session.clear()).toThrow(/完成/);expect(port.hasKey(profile)).toBe(true);
 let disposeError:unknown;try{session.dispose();}catch(error){disposeError=error;}const retainedKey=port.hasKey(profile);gate.resolve();const result=await paying;const stopped=await queued;
 expect(disposeError).toBeUndefined();expect(retainedKey).toBe(false);expect(result).toBe('reply');expect(stopped).toHaveProperty('error');expect(posts).toBe(1);expect(c.pendingDocument().state.usageRecords).toHaveLength(1);
});
it('persisted phase records prevent a paid resend by a newly created session',async()=>{
 let posts=0;const {c,port,session,input}=await setup(async()=>{posts++;return response();});await session.chat(input);
 const {createModelSession}=await import('../src/core/model-session');const reloaded=createModelSession(port,c);await expect(reloaded.chat(input)).rejects.toThrow(/已有用量/);expect(posts).toBe(1);expect(c.pendingDocument().state.usageRecords).toHaveLength(1);
});
it('requestId cannot be rebound to a different action after payment',async()=>{
 let posts=0;const {session,input}=await setup(async()=>{posts++;return response();});await session.chat(input);await expect(session.chat({...input,task:'different paid action'})).rejects.toThrow(/标识/);expect(posts).toBe(1);
});
it('connection test needs no learning column, records test usage once and shares restore guards',async()=>{
 const gate=deferred<Response>();let posts=0;let sent:any;const {c,session}=await setup(async(_url,init)=>{posts++;sent=JSON.parse(init!.body as string);return gate.promise;});await c.change(d=>({...d,state:{...d.state,columns:[]}}));
 const input={library:library(),requestId:'connection'};expect(session.test,'tracked connection-test interface').toBeTypeOf('function');const pending=session.test(input);const duplicate=session.test(input);await vi.waitFor(()=>expect(posts).toBe(1));
 await expect(c.replace(c.pendingDocument())).rejects.toMatchObject({code:'unavailable'});gate.resolve(response('connected'));expect(await pending).toBe('connected');expect(await duplicate).toBe('connected');
 const doc=c.pendingDocument();expect(posts).toBe(1);expect(doc.state.columns).toEqual([]);expect(doc.state.contexts).toEqual({});expect(doc.state.usageRecords).toHaveLength(1);expect(doc.state.usageRecords[0].purpose).toBe('test');expect(doc.drafts.messages.c).toBe('unsent draft');
 expect(sent).toEqual({model:'m',instructions:'这是用户主动发起的 API 连接测试。只回复 OK。',input:[{role:'user',content:'请回复 OK。'}]});
});
it('connection test recovers paid result after quota failure without a POST or learning state change',async()=>{
 let posts=0;const {c,r,session}=await setup(async()=>{posts++;return response('connected');});const before=c.pendingDocument();const commit=r.commit;let fail=true;r.commit=async(d,rev)=>{if(fail)throw new BrowserStorageError('quota','full');return commit(d,rev);};
 expect(session.test,'tracked connection-test interface').toBeTypeOf('function');const input={library:library(),requestId:'connection'};await expect(session.test(input)).rejects.toThrow('full');fail=false;expect(await session.test(input)).toBe('connected');expect(posts).toBe(1);
 expect(c.pendingDocument().state.contexts).toEqual(before.state.contexts);expect(c.pendingDocument().state.columns).toEqual(before.state.columns);expect(c.pendingDocument().drafts).toEqual(before.drafts);expect(c.pendingDocument().state.usageRecords).toHaveLength(1);
});
it('connection test preserves textless billed usage and unknown canceled usage without retries',async()=>{
 let posts=0;const {c,session}=await setup(async(_url,init)=>{posts++;if(posts===1)return response('');return await new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(Error('canceled')),{once:true}));});expect(session.test,'tracked connection-test interface').toBeTypeOf('function');
 const input={library:library(),requestId:'textless-test'};await expect(session.test(input)).rejects.toThrow('模型没有返回文本');await expect(session.test(input)).rejects.toThrow('模型没有返回文本');expect(posts).toBe(1);
 const aborted=new AbortController();aborted.abort();await expect(session.test({...input,requestId:'preabort-test'},aborted.signal)).rejects.toThrow();expect(posts).toBe(1);
 const active=new AbortController();const pending=session.test({...input,requestId:'abort-test'},active.signal);await vi.waitFor(()=>expect(posts).toBe(2));active.abort();await expect(pending).rejects.toThrow('canceled');expect(c.pendingDocument().state.usageRecords.map(r=>[r.purpose,r.usage?.inputTokens??null])).toEqual([['test',80],['test',null]]);
});
