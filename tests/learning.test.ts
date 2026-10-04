import { describe, expect, it } from 'vitest';
import { addressGap, beginStudy, beginVerification, confirmEvidence, confirmPlan, completeStep, createColumn, proposeEvidence, recordAnswer, recordTeachback, skipStep } from '../src/core/learning';

describe('learning progression', () => {
  const draft = { target: '独立写出一个 HTTP 接口', steps: [{ id: 's1', title: 'HTTP 请求', outcome: '解释请求和响应并运行最小例子', priority: 1 }, { id: 's2', title: '路由', outcome: '独立实现路由', priority: 2 }] };

  it('requires a reviewed plan before study and asks no baseline question', () => {
    const column = createColumn('后端', '做一个 API', '2026-09-26T10:00:00.000Z');
    expect(column.phase).toBe('planning');
    expect(column.messages).toEqual([]);
    const approved = confirmPlan(column, draft);
    expect(approved.phase).toBe('overview');
    expect(beginStudy(approved).phase).toBe('study');
  });

  it('starts verification only after the current block was taught', () => {
    const column = beginStudy(confirmPlan(createColumn('后端', '做 API', '2026-09-26T10:00:00.000Z'), draft));
    expect(() => beginVerification(column)).toThrow('先学习当前知识块');
    const taught = { ...column, taughtStepIds: ['s1'] };
    expect(beginVerification(taught).phase).toBe('verify');
  });

  it('records help level and does not grant independent mastery after hints', () => {
    const column = beginVerification({ ...beginStudy(confirmPlan(createColumn('后端', '做 API', '2026-09-26T10:00:00.000Z'), draft)), taughtStepIds: ['s1'] });
    const answered = recordAnswer(column, '请求由方法、路径和正文组成', 'hinted', '2026-09-26T11:00:00.000Z');
    expect(answered.phase).toBe('teachback');
    const reflected = recordTeachback(answered, '我学会了请求和响应，还不清楚状态码', '2026-09-26T11:05:00.000Z');
    expect(reflected.evidence[0].level).toBe('初步理解');
    expect(reflected.evidence[0].helpLevel).toBe('hinted');
  });

  it('never certifies independent or stable mastery from text-only evidence', () => {
    const start = beginVerification({ ...beginStudy(confirmPlan(createColumn('后端', '做 API', '2026-09-26T10:00:00.000Z'), draft)), taughtStepIds: ['s1'] });
    const reflected = recordTeachback(recordAnswer(start, '我能描述请求结构', 'independent', '2026-09-26T11:00:00.000Z'), '我用自己的话解释了请求。', '2026-09-26T11:01:00.000Z');
    const id = reflected.evidence[0].id;
    expect(proposeEvidence(reflected, id, '稳定掌握', '一次回答').evidence[0].level).toBe('初步理解');
    expect(() => confirmEvidence(reflected, id, '稳定掌握')).toThrow('文字');
    expect(() => confirmEvidence(reflected, id, '可独立应用')).toThrow('文字');
  });

  it('marks a skipped block unverified and preserves the next step', () => {
    const column = beginStudy(confirmPlan(createColumn('后端', '做 API', '2026-09-26T10:00:00.000Z'), draft));
    const skipped = skipStep(column);
    expect(skipped.plan?.steps[0].status).toBe('待验证');
    expect(skipped.currentStepIndex).toBe(1);
    expect(skipped.phase).toBe('overview');
    expect(() => beginVerification(skipped)).toThrow();
  });

  it('requires teaching before asking about the next block too', () => {
    const start = beginVerification({ ...beginStudy(confirmPlan(createColumn('后端', '做 API', '2026-09-26T10:00:00.000Z'), draft)), taughtStepIds: ['s1'] });
    const reflected = recordTeachback(recordAnswer(start, '我能描述请求', 'independent', '2026-09-26T11:00:00.000Z'), '还缺独立写代码', '2026-09-26T11:02:00.000Z');
    const verified = confirmEvidence(reflected, reflected.evidence[0].id, '初步理解');
    const next = completeStep(verified);
    expect(next.phase).toBe('overview');
    expect(() => beginVerification(next)).toThrow();
  });

  it('waits for a stated gap to be addressed before advancing', () => {
    const start = beginVerification({ ...beginStudy(confirmPlan(createColumn('后端', '做 API', '2026-09-26T10:00:00.000Z'), draft)), taughtStepIds: ['s1'] });
    const reflected = recordTeachback(recordAnswer(start, '路径选择函数', 'independent', '2026-09-26T11:00:00.000Z'), '还不会写响应', '2026-09-26T11:02:00.000Z');
    const id = reflected.evidence[0].id;
    const suggested = proposeEvidence(reflected, id, '初步理解', '能描述路径', '还不会写响应');
    const confirmed = confirmEvidence(suggested, id, '初步理解');
    expect(() => completeStep(confirmed)).toThrow();
    expect(completeStep(addressGap(confirmed, id, true)).phase).toBe('overview');
  });
});

 it('preserves exact learner whitespace and code indentation in answer and teachback', () => {
 const column = beginVerification({...beginStudy(confirmPlan(createColumn('代码','解释函数','2026-10-05'),{target:'理解',steps:[{id:'s',title:'函数',outcome:'运行函数',priority:1}]})),taughtStepIds:['s']});
 const answer = '  中文\n    return name;\n '; const teachback = '\n  我理解了参数  \n';
 const result = recordTeachback(recordAnswer(column,answer,'explained','2026-10-05'),teachback,'2026-10-05');
 expect(result.evidence[0].answer).toBe(answer); expect(result.evidence[0].teachback).toBe(teachback);
 });
