import {afterEach,it,expect,vi} from 'vitest';
import {ModelOperations} from '../src/node/model-operations';
import {runConversation} from '../src/node/conversation';
import {contextDecision, type ContextTurn} from '../src/core/context-cache';
import {callModelDetailed,ModelResponseError} from '../src/core/providers';
import {ModelRuntime} from '../src/node/model-runtime';
import {trackRequest} from '../src/node/usage-tracker';
const history=Array.from({length:30},(_,i)=>({id:String(i),role:'user' as const,content:`raw ${i}`}));
const usage={inputTokens:850,cachedInputTokens:400,uncachedInputTokens:450,cacheWriteTokens:null,outputTokens:100};
afterEach(()=>vi.unstubAllGlobals());
it('blocks restore throughout delayed manual compaction so its anchor cannot leak into older backup',async()=>{
  const operations=new ModelOperations();let release!:()=>void;const gate=new Promise<void>(r=>release=r);let context:any={};let restored=false;
  const pending=operations.run(()=>runConversation({history,system:'s',task:'t',context:{},profileId:'p',model:'m',compactOnly:true},async()=>{await gate;return {text:'summary',usage};},async c=>{context=c;}));
  await expect(operations.restore(async()=>{restored=true;})).rejects.toThrow(/完成/);
  expect(restored).toBe(false);release();await pending;expect(context.checkpoint.throughId).toBe('21');
  await operations.restore(async()=>{context={};restored=true;});expect(context).toEqual({});
});
it('blocks model work while a restore dialog is pending, and releases on cancel or error',async()=>{
  const operations=new ModelOperations();let release!:()=>void;const gate=new Promise<void>(r=>release=r);
  const restore=operations.restore(async()=>{await gate;});
  await expect(operations.run(async()=>1)).rejects.toThrow(/恢复/);release();await restore;
  await expect(operations.run(async()=>{throw Error('offline');})).rejects.toThrow('offline');
  expect(await operations.restore(async()=>1)).toBe(1);
});
it('does not automatically pay for an ineffective summary on every turn; rearms below threshold',async()=>{
  let context:any={lastInput:{profileId:'p',model:'m',inputTokens:850,throughId:null}};const calls:string[]=[];let input=850;
  const request=async(_s:string,_t:any[],p:string)=>{calls.push(p);return {text:p==='summary'?'summary':'reply',usage:{...usage,inputTokens:input}};};
  let h:ContextTurn[]=[...history];const send=async()=>{const result=await runConversation({history:h,system:'s',task:'t',context,profileId:'p',model:'m',window:1000},request,async c=>{context=c;});context=result.context;h=[...h,{id:String(h.length),role:'user',content:'next'},{id:String(h.length+1),role:'assistant',content:'reply'}];};
  await send();await send();await send();expect(calls).toEqual(['summary','chat','chat','chat']);
  expect(contextDecision(h,context.checkpoint,1000,context.lastInput,'p','m')).toBe('pressure');
  input=700;await send();input=850;await send();await send();expect(calls.filter(c=>c==='summary')).toHaveLength(2);
});
it('records usage from incomplete text responses exactly once and still redacts server errors',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'incomplete',output:[],usage:{input_tokens:800,input_tokens_details:{cached_tokens:400},output_tokens:100}}))));
  const p={id:'p',name:'P',baseUrl:'http://localhost:1',protocol:'responses' as const,models:['m']};const runtime=new ModelRuntime();runtime.setKey(p,'private-key');const snapshot=runtime.snapshot({profiles:[p],active:{profileId:'p',model:'m'}});const records:any[]=[];
  await expect(trackRequest(snapshot,'s',[],'chat',async record=>{records.push(record);})).rejects.toThrow('模型没有返回文本');
  expect(records).toHaveLength(1);expect(records[0].usage).toMatchObject({inputTokens:800,cachedInputTokens:400,outputTokens:100});
  expect(JSON.stringify(records)).not.toContain('private-key');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{message:'private-key'},usage:{input_tokens:50,output_tokens:0}}),{status:400})));
  await expect(trackRequest(snapshot,'s',[],'summary',async r=>{records.push(r);})).rejects.toThrow('[已隐藏 API Key]');
  expect(records.at(-1).usage.inputTokens).toBe(50);
});
it('records transport failure as unknown rather than zero; persistence failure does not duplicate records',async()=>{
  const records:any[]=[];const p={profile:{id:'p'},settings:{model:'m'},chatDetailed:async()=>{throw Error('offline');}} as any;
  await expect(trackRequest(p,'',[],'chat',async r=>{records.push(r);})).rejects.toThrow('offline');
  expect(records).toHaveLength(1);expect(records[0].usage).toBeNull();
  let writes=0;const s={...p,chatDetailed:async()=>({text:'hello',usage})};
  await expect(trackRequest(s,'',[],'chat',async()=>{writes++;throw Error('disk full');})).rejects.toThrow('disk full');expect(writes).toBe(1);
});
