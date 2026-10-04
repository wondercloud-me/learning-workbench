import { describe, expect, it } from 'vitest';
import { runConversation } from '../src/node/conversation';
import { emptyState,validateState,cleanBackup } from '../src/core/state';
import { validateProfile } from '../src/core/model-library';
import { aggregateUsage, usageRecord } from '../src/core/usage';
import { learningRequest } from '../src/core/prompts';
import { createColumn, type LearningColumn } from '../src/core/learning';
const history=Array.from({length:30},(_,i)=>({id:String(i),role:i%2?'assistant' as const:'user' as const,content:`raw ${i}`}));
const usage={inputTokens:100,cachedInputTokens:0,uncachedInputTokens:100,cacheWriteTokens:null,outputTokens:10};
it('phase changes keep teaching rules and shared history prefix with dynamic task last',()=>{
  const column=createColumn('API','build','now','00000000-0000-0000-0000-000000000000');
  const a=learningRequest(column,history,'first');
  const b=learningRequest({...column,phase:'verify'} as LearningColumn,history,'second');
  expect(a.system).toBe(b.system);expect(a.turns.slice(0,-1)).toEqual(b.turns.slice(0,-1));
  expect(b.turns.at(-1)?.content).toContain('verify');expect(b.system).not.toContain('阶段：');
});
it('per-model windows survive backup validation while secrets are discarded',()=>{
  const profile=validateProfile({id:'p',name:'P',baseUrl:'http://localhost:1',protocol:'chat',models:['a','b'],contextWindows:{a:32000,b:128000,other:10},apiKey:'secret'} as any);
  expect(profile.contextWindows).toEqual({a:32000,b:128000});expect(JSON.stringify(profile)).not.toContain('secret');
  const s=emptyState();s.columns=[createColumn('Title','goal','now','00000000-0000-0000-0000-000000000001')];s.contexts={c:{checkpoint:{summary:'summary',throughId:'a',createdAt:'now'}}};
  s.usageRecords=[usageRecord('p','a','chat',usage,'now','r')];
  const restored=validateState(cleanBackup(s));expect(restored.contexts).toEqual(s.contexts);expect(restored.usageRecords).toEqual(s.usageRecords);
  expect(restored.columns).toEqual(s.columns);
});
it('aggregate cache rate excludes missing pairs and keeps explicit zeros',()=>{
  const records=[usageRecord('p','m','chat',usage,'now','1'),usageRecord('p','m','summary',{...usage,inputTokens:300,cachedInputTokens:150},'now','2'),usageRecord('p','m','test',{...usage,inputTokens:900,cachedInputTokens:null},'now','3')];
  expect(aggregateUsage(records).cacheRate).toBe(150/400);expect(aggregateUsage(records).inputTokens).toBe(1300);
  expect(aggregateUsage([records[0]]).cacheRate).toBe(0);expect(aggregateUsage([records[2]]).cacheRate).toBeNull();
});
it('compacts once, keeps recent originals, persists before answer and attributes both requests',async()=>{
  const calls:any[]=[];const saved:any[]=[];
  const context={lastInput:{profileId:'p',model:'m',inputTokens:800,throughId:null}};
  const request=async(system:string,turns:any[],purpose:string)=>{calls.push({system,turns,purpose});return {text:purpose==='summary'?'frozen summary':'answer',usage};};
  const options={history,system:'fixed',task:'study',context,window:1000,profileId:'p',model:'m'};
  const result=await runConversation(options,request,async c=>{saved.push(c);});
  expect(calls.map(c=>c.purpose)).toEqual(['summary','chat']);expect(calls[1].turns[0].content).toContain('frozen summary');
  expect(calls[1].turns.slice(1,-1)).toEqual(history.slice(-8).map(({role,content})=>({role,content})));
  calls.length=0;
  await runConversation({...options,history:[...history,{id:'30',role:'assistant',content:'answer'}],context:result.context},request,async()=>{});
  expect(calls.map(c=>c.purpose)).toEqual(['chat']);expect(saved[0].checkpoint.summary).toBe('frozen summary');expect(history).toHaveLength(30);
});
it('unknown windows never issue an automatic paid summary; manual does',async()=>{
  const calls:string[]=[];const h=history.map(t=>({...t,content:'x'.repeat(1000)}));
  const options={history:h,system:'fixed',task:'x',context:{},profileId:'p',model:'m'};
  const request=async(_s:string,_t:any[],p:string)=>{calls.push(p);return {text:'x',usage:null};};
  await runConversation(options,request,async()=>{});expect(calls).toEqual(['chat']);calls.length=0;
  await runConversation({...options,compactOnly:true},request,async()=>{});expect(calls).toEqual(['summary']);
});
it('summary errors leave original checkpoints and histories untouched',async()=>{
  const c={lastInput:{profileId:'p',model:'m',inputTokens:999,throughId:null}};const saved:any[]=[];
  await expect(runConversation({history,system:'s',task:'t',context:c,window:1000,profileId:'p',model:'m'},async()=>{throw Error('offline');},async x=>{saved.push(x);})).rejects.toThrow('offline');
  expect(saved).toEqual([]);expect(c).not.toHaveProperty('checkpoint');expect(history).toHaveLength(30);
});
