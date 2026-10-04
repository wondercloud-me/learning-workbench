import {createColumn} from '../src/core/learning';
import { describe, expect, it } from 'vitest';
import { carrySideChatConclusion, createSideChat,carryToTeachingDraft } from '../src/core/sidechat';

describe('side chat isolation', () => {
  it('copies only the quote, source message and column goal into its context', () => {
    const side = createSideChat({ id: 'side-1', columnId: 'c1', parentMessageId: 'm1', selectedText: '异步请求', sourceMessage: '浏览器发起异步请求，再等待响应。', columnGoal: '学前端', now: '2026-09-26T10:00:00.000Z' });
    expect(side.context).toEqual({ quote: '异步请求', sourceMessage: '浏览器发起异步请求，再等待响应。', goal: '学前端' });
    expect(side.messages).toEqual([]);
  });

  it('returns a draft without mutating either conversation', () => {
    const side = createSideChat({ id: 'side-1', columnId: 'c1', parentMessageId: 'm1', selectedText: '异步请求', sourceMessage: '浏览器发起异步请求。', columnGoal: '学前端', now: '2026-09-26T10:00:00.000Z' });
    const draft = carrySideChatConclusion(side, '异步请求让页面不用等待网络才能继续操作。');
    expect(draft).toContain('异步请求让页面不用等待网络才能继续操作。');
    expect(side.messages).toEqual([]);
  });
});

it('carries a teaching side conclusion to its original chapter after selecting another chapter',()=>{
 const a=createColumn('A','学会A','now','a'),b=createColumn('B','学会B','now','b');
 const side=createSideChat({id:'s',columnId:'a',parentMessageId:'m',selectedText:'循环',sourceMessage:'循环示例',columnGoal:'学会A',now:'now'});
 const result=carryToTeachingDraft(side,'重复执行',[a,b],{a:'A原草稿',b:'B原草稿'});
 expect(result.target.id).toBe('a');expect(result.drafts.a).toContain('重复执行');expect(result.drafts.b).toBe('B原草稿');expect(a.messages).toEqual([]);expect(b.messages).toEqual([]);
});
