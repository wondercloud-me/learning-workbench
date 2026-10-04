import { describe,it,expect } from 'vitest';
import { selectContext, contextDecision, compactableHistory, createCheckpoint, boundToolOutput } from '../src/core/context-cache';
const history=Array.from({length:30},(_,i)=>({id:String(i),role:i%2?'assistant' as const:'user' as const,content:`turn ${i}`}));
it('keeps the opening history after 25 messages, without mutating originals',()=>{
  expect(selectContext(history).map(x=>x.content)).toEqual(history.map(x=>x.content));
  expect(selectContext([...history,{id:'30',role:'user',content:'next'}]).slice(0,30)).toEqual(selectContext(history));
});
it('uses reported usage only for the current API/model and checkpoint',()=>{
  const last={profileId:'a',model:'m',inputTokens:800,throughId:null};
  expect(contextDecision(history,undefined,1000,last,'a','m')).toBe('auto');
  expect(contextDecision(history,undefined,1000,{...last,inputTokens:799},'a','m')).toBe('none');
  expect(contextDecision(history,undefined,1000,last,'b','m')).toBe('none');
});
it('warns manually with unknown window or missing usage, never auto',()=>{
  const h=[...history,{id:'long',role:'user' as const,content:'中'.repeat(16000)}];
  expect(contextDecision(h,undefined,undefined,undefined,'a','m')).toBe('manual');
  expect(contextDecision(h,undefined,1000,undefined,'a','m')).toBe('manual');
});
it('freezes summaries and retains recent originals; stale input cannot summarize again',()=>{
  const checkpoint=createCheckpoint(history,'summary','now');
  expect(compactableHistory(history).length).toBe(22);
  expect(selectContext(history,checkpoint)[0].content).toContain('summary');
  expect(selectContext(history,checkpoint).slice(1)).toEqual(history.slice(-8).map(({role,content})=>({role,content})));
  expect(contextDecision(history,checkpoint,1000,{profileId:'a',model:'m',inputTokens:900,throughId:null},'a','m')).toBe('none');
  const next=[...history,{id:'30',role:'user' as const,content:'next'}];
  expect(selectContext(next,checkpoint).slice(0,-1)).toEqual(selectContext(history,checkpoint));
  expect(history).toHaveLength(30);
});
it('rejects a stale summary anchor and huge individual content instead of deleting text',()=>{
  expect(()=>selectContext(history,{summary:'x',throughId:'missing',createdAt:'now'})).toThrow(/摘要/);
  expect(()=>selectContext([{id:'x',role:'user',content:'x'.repeat(128001)}])).toThrow(/单条/);
});
it('limits model-visible tool UTF8 bytes while marking omissions',()=>{
  const original='中文🙂'.repeat(20000);
  const visible=boundToolOutput(original);
  expect(new TextEncoder().encode(visible).length).toBeLessThanOrEqual(32768);
  expect(visible).toContain('已省略');expect(visible).not.toContain('�');
  expect(original.length).toBe(80000);
});
