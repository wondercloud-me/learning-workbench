import {expect, it} from 'vitest';
import {createBackup} from '../src/core/backup';
import {emptyBrowserDocument} from '../src/core/browser-state';
import type {ApiProfile, ModelLibrary} from '../src/core/model-library';
import {trackRequest} from '../src/node/usage-tracker';
import {ModelRuntime} from '../src/node/model-runtime';

const profile: ApiProfile = {id:'p',name:'P',baseUrl:'https://models.example/v1',protocol:'responses',models:['m'],contextWindows:{m:1000}};
const library = (): ModelLibrary => ({profiles:[structuredClone(profile)],active:{profileId:'p',model:'m'}});
const reply = () => new Response(JSON.stringify({output_text:'answer',usage:{input_tokens:80,input_tokens_details:{cached_tokens:40},output_tokens:10}}));
async function port(fetcher: typeof fetch) {
 const module = await import('../src/browser/model-port').catch(()=>undefined);
 expect(module?.BrowserModelPort, 'browser memory-only model port is available').toBeTypeOf('function');
 return new module!.BrowserModelPort(fetcher);
}
it('keysNeverEnterDocumentBackupOrReloadedPort',async()=>{
 const p=await port(async()=>reply());p.setKey(profile,'private-session-key');
 const document=emptyBrowserDocument();document.state.settings.modelLibrary=library();
 expect(JSON.stringify([p,p.snapshot(library()),document,createBackup(document,'0.9.0','2026-10-05T10:00:00.000Z')])).not.toContain('private-session-key');
 expect((await port(async()=>reply())).hasKey(profile)).toBe(false);
 p.clearKeys();expect(p.hasKey(profile)).toBe(false);
});
it('sends only selected destination and key with credentials omit through an immutable snapshot',async()=>{
 const requests:Array<{url:string;init:RequestInit}>=[];
 const p=await port(async(url,init)=>{requests.push({url:String(url),init:init!});return reply();});
 const source=library();const other={...profile,id:'other',baseUrl:'https://other.example',protocol:'chat' as const};source.profiles.push(other);
 p.setKey(profile,'original-key');p.setKey(other,'other-key');const snapshot=p.snapshot(source);
 source.profiles[0].contextWindows!.m=3000;source.active={profileId:'other',model:'m'};p.setKey(profile,'replacement-key');p.clearKeys();
 expect(snapshot.profile.contextWindows!.m).toBe(1000);
 expect(await snapshot.chat('system',[{role:'user',content:'chosen context'}])).toBe('answer');
 expect(requests).toHaveLength(1);expect(requests[0].url).toBe('https://models.example/v1/responses');
 expect(requests[0].init.credentials).toBe('omit');expect(requests[0].init.headers).toMatchObject({authorization:'Bearer original-key'});
 expect(JSON.parse(requests[0].init.body as string)).toEqual({model:'m',instructions:'system',input:[{role:'user',content:'chosen context'}]});
});
it('changingEndpointInvalidatesKeyBinding and rejects unsafe URLs before dispatch',async()=>{
 let posts=0;const p=await port(async()=>{posts++;return reply();});p.setKey(profile,'key');
 for(const changed of [{...profile,baseUrl:'https://changed.example'},{...profile,protocol:'chat' as const}]){
  expect(p.hasKey(changed)).toBe(false);expect(()=>p.snapshot({profiles:[changed],active:{profileId:'p',model:'m'}})).toThrow();
 }
 for(const baseUrl of ['http://localhost:8000','https://u:secret@models.example','https://models.example?key=x','https://models.example#x']){
  const changed={...profile,baseUrl};expect(()=>p.setKey(changed,'key')).toThrow();expect(p.hasKey(changed)).toBe(false);
  expect(()=>p.snapshot({profiles:[changed],active:{profileId:'p',model:'m'}})).toThrow();
 }
 expect(posts).toBe(0);
});
it('doesNotRetryPaidRequestsAutomatically and redactsProviderEchoedKey while retaining usage',async()=>{
 let posts=0;const p=await port(async()=>{posts++;return new Response(JSON.stringify({error:{message:'rejected private-key'},usage:{input_tokens:50,output_tokens:0}}),{status:400});});p.setKey(profile,'private-key');
 const records:any[]=[];await expect(trackRequest(p.snapshot(library()),'system',[],'chat',async r=>{records.push(r);})).rejects.toThrow('[已隐藏 API Key]');
 expect(posts).toBe(1);expect(records).toHaveLength(1);expect(records[0].usage.inputTokens).toBe(50);expect(JSON.stringify(records)).not.toContain('private-key');
});
it('pre-aborted tracking dispatches no paid call and external cancellation reaches the provider',async()=>{
 let posts=0;let observed:AbortSignal|undefined;
 const runtime=new ModelRuntime(undefined,async(_s,_k,_system,_turns,signal)=>{posts++;observed=signal;return await new Promise((_resolve,reject)=>signal!.addEventListener('abort',()=>reject(new Error('canceled')),{once:true}));});runtime.setKey(profile,'key');
 const snapshot=runtime.snapshot(library());const canceled=new AbortController();canceled.abort();const records:any[]=[];
 await expect(trackRequest(snapshot,'',[],'chat',async r=>{records.push(r);},180000,()=> 'before',canceled.signal)).rejects.toThrow();expect(posts).toBe(0);
 const active=new AbortController();const pending=trackRequest(snapshot,'',[],'chat',async r=>{records.push(r);},180000,()=> 'active',active.signal);active.abort();await expect(pending).rejects.toThrow('canceled');
 expect(observed?.aborted).toBe(true);expect(records.at(-1)).toMatchObject({id:'active',usage:null});
});
it('timeout remains active when an external signal is provided',async()=>{
 const runtime=new ModelRuntime(undefined,async(_s,_k,_system,_turns,signal)=>await new Promise((_resolve,reject)=>signal!.addEventListener('abort',()=>reject(new Error('timed out')),{once:true})));runtime.setKey(profile,'key');const records:any[]=[];
 await expect(trackRequest(runtime.snapshot(library()),'',[],'chat',async r=>{records.push(r);},5,()=> 'timeout',new AbortController().signal)).rejects.toThrow('timed out');expect(records[0]).toMatchObject({id:'timeout',usage:null});
});
