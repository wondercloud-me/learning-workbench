import { describe, expect, it } from 'vitest';
import { createDemo, demoAction, type DemoAction, type DemoState } from '../src/core/quick-demo';

function advance(state: DemoState, ...actions: DemoAction[]): DemoState {
  return actions.reduce((current, action) => demoAction(Object.freeze(current), action), state);
}

function beginLesson(): DemoState {
  return advance(createDemo(), { type: 'set-target', value: '看懂一次请求和响应' }, { type: 'confirm-plan' });
}

function beginAnswer(): DemoState {
  return advance(beginLesson(), { type: 'show-response' }, { type: 'continue-lesson' }, { type: 'open-side' }, { type: 'continue-side' });
}

describe('offline quick demo', () => {
  it('requires a written target before starting the lesson', () => {
    const blank = advance(createDemo(), { type: 'set-target', value: ' \n ' });
    expect(demoAction(blank, { type: 'confirm-plan' })).toBe(blank);
    expect(beginLesson()).toMatchObject({ phase: 'lesson', planTarget: '看懂一次请求和响应', responseShown: false });
  });

  it('requires seeing the fixed response and opening a side conversation before answering', () => {
    const lesson = beginLesson();
    expect(demoAction(lesson, { type: 'continue-lesson' })).toBe(lesson);
    const side = advance(lesson, { type: 'show-response' }, { type: 'continue-lesson' });
    expect(side).toMatchObject({ phase: 'side', responseShown: true, sideOpened: false });
    expect(demoAction(side, { type: 'continue-side' })).toBe(side);
    expect(advance(side, { type: 'open-side' }, { type: 'continue-side' })).toMatchObject({ phase: 'answer', sideOpened: true });
  });

  it('ignores actions from later phases so learning cannot be skipped', () => {
    const initial = createDemo();
    const attemptedSkip = advance(initial,
      { type: 'show-response' }, { type: 'continue-lesson' }, { type: 'open-side' }, { type: 'continue-side' },
      { type: 'set-answer', value: '先答题' }, { type: 'continue-answer' },
      { type: 'set-recap', value: '先复述' }, { type: 'continue-recap' },
      { type: 'set-gap', value: '先记录' }, { type: 'continue-gap' }, { type: 'check-in' });
    expect(attemptedSkip).toBe(initial);
    expect(attemptedSkip).toMatchObject({ phase: 'plan', answer: '', recap: '', gap: '', checkedIn: false });
  });

  it('keeps side notes and the main draft separate until the user carries text back', () => {
    const side = advance(beginLesson(), { type: 'show-response' }, { type: 'continue-lesson' }, { type: 'open-side' });
    const written = advance(side, { type: 'set-side-draft', value: '200 和正文有什么区别？' });
    expect(written.mainDraft).toBe('');
    expect(side.sideDraft).toBe('');
    const carried = advance(written, { type: 'set-main-draft', value: '200 是状态码，正文是返回的数据。' });
    expect(carried.sideDraft).toBe('200 和正文有什么区别？');
    expect(carried.mainDraft).toBe('200 是状态码，正文是返回的数据。');
  });

  it('accepts nonempty personal text without grading and only finishes after demo check-in', () => {
    let state = beginAnswer();
    for (const step of [
      { set: 'set-answer', next: 'continue-answer', phase: 'recap', text: '我还不确定' },
      { set: 'set-recap', next: 'continue-recap', phase: 'gap', text: '我只理解了请求在前' },
      { set: 'set-gap', next: 'continue-gap', phase: 'checkin', text: '状态码还需要再看一次' },
    ] as const) {
      const blank = advance(state, { type: step.set, value: ' \n ' });
      expect(demoAction(blank, { type: step.next })).toBe(blank);
      state = advance(state, { type: step.set, value: step.text }, { type: step.next });
      expect(state.phase).toBe(step.phase);
      expect(state.checkedIn).toBe(false);
    }
    const done = advance(state, { type: 'check-in' });
    expect(done).toMatchObject({ phase: 'done', checkedIn: true, answer: '我还不确定', recap: '我只理解了请求在前', gap: '状态码还需要再看一次' });
    expect(demoAction(done, { type: 'set-answer', value: '覆盖记录' })).toBe(done);
  });

  it('restarts with all inputs cleared while leaving the previous demo unchanged', () => {
    const completed = advance(beginAnswer(),
      { type: 'set-answer', value: '我的回答' }, { type: 'continue-answer' },
      { type: 'set-recap', value: '我的复述' }, { type: 'continue-recap' },
      { type: 'set-gap', value: '我的卡点' }, { type: 'continue-gap' }, { type: 'check-in' });
    const restarted = advance(completed, { type: 'reset' });
    expect(restarted).toEqual({ phase: 'plan', planTarget: '', responseShown: false, sideOpened: false, sideDraft: '', mainDraft: '', answer: '', recap: '', gap: '', checkedIn: false });
    expect(completed).toMatchObject({ phase: 'done', checkedIn: true, answer: '我的回答' });
    expect(createDemo()).not.toBe(restarted);
  });
});
