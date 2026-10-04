/** Fixed offline demonstration. This module owns no real learning or check-in state. */
export type DemoPhase = 'plan' | 'lesson' | 'side' | 'answer' | 'recap' | 'gap' | 'checkin' | 'done';

export interface DemoState {
  phase: DemoPhase;
  planTarget: string;
  responseShown: boolean;
  sideOpened: boolean;
  sideDraft: string;
  mainDraft: string;
  answer: string;
  recap: string;
  gap: string;
  checkedIn: boolean;
}

export type DemoAction =
  | { type: 'set-target'; value: string }
  | { type: 'confirm-plan' }
  | { type: 'show-response' }
  | { type: 'continue-lesson' }
  | { type: 'open-side' }
  | { type: 'set-side-draft'; value: string }
  | { type: 'set-main-draft'; value: string }
  | { type: 'continue-side' }
  | { type: 'set-answer'; value: string }
  | { type: 'continue-answer' }
  | { type: 'set-recap'; value: string }
  | { type: 'continue-recap' }
  | { type: 'set-gap'; value: string }
  | { type: 'continue-gap' }
  | { type: 'check-in' }
  | { type: 'reset' };

export const demoSteps: ReadonlyArray<{ phase: DemoPhase; title: string }> = [
  { phase: 'plan', title: '选择教学内容' },
  { phase: 'lesson', title: '学习一小步' },
  { phase: 'side', title: '试试辅助对话' },
  { phase: 'answer', title: '写下回答' },
  { phase: 'recap', title: '自己复述' },
  { phase: 'gap', title: '补充理解' },
  { phase: 'checkin', title: '体验打卡' },
  { phase: 'done', title: '体验完成' },
];

export const demoContent = {
  request: 'GET /hello HTTP/1.1',
  response: 'HTTP/1.1 200 OK\nContent-Type: application/json\n\n{\n  "message": "你好"\n}',
  lesson: '这是固定的离线演示，没有真的发送网络请求。\n\n请求中的 GET 是方法，表示想读取资源；/hello 是路径，告诉服务器要找哪个入口。点击“模拟发送”后，看看下面预先准备好的响应。\n\n响应中的 200 是状态码。状态码 200 表示这次请求成功处理。空行后的 JSON 是响应正文，也就是服务器返回的数据；这里 message 的值是“你好”。\n\n你现在可以把一轮交互读成：用 GET 请求 /hello，收到状态码 200，再从正文读出“你好”。',
  quote: '状态码 200 表示这次请求成功处理。',
  sideReply: '固定示范回复：状态码告诉你这次请求处理得怎样，响应正文给出返回的数据。在这个例子中，200 表示成功，正文里的 message 才是“你好”。两者在响应里承担不同的工作。',
};

export function createDemo(): DemoState {
  return { phase: 'plan', planTarget: '', responseShown: false, sideOpened: false, sideDraft: '', mainDraft: '', answer: '', recap: '', gap: '', checkedIn: false };
}

export function demoAction(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case 'reset':
      return createDemo();
    case 'set-target':
      return state.phase === 'plan' ? { ...state, planTarget: action.value } : state;
    case 'confirm-plan':
      return state.phase === 'plan' && state.planTarget.trim() ? { ...state, phase: 'lesson' } : state;
    case 'show-response':
      return state.phase === 'lesson' ? { ...state, responseShown: true } : state;
    case 'continue-lesson':
      return state.phase === 'lesson' && state.responseShown ? { ...state, phase: 'side' } : state;
    case 'open-side':
      return state.phase === 'side' ? { ...state, sideOpened: true } : state;
    case 'set-side-draft':
      return state.phase === 'side' && state.sideOpened ? { ...state, sideDraft: action.value } : state;
    case 'set-main-draft':
      return state.phase === 'side' && state.sideOpened ? { ...state, mainDraft: action.value } : state;
    case 'continue-side':
      return state.phase === 'side' && state.sideOpened ? { ...state, phase: 'answer' } : state;
    case 'set-answer':
      return state.phase === 'answer' ? { ...state, answer: action.value } : state;
    case 'continue-answer':
      return state.phase === 'answer' && state.answer.trim() ? { ...state, phase: 'recap' } : state;
    case 'set-recap':
      return state.phase === 'recap' ? { ...state, recap: action.value } : state;
    case 'continue-recap':
      return state.phase === 'recap' && state.recap.trim() ? { ...state, phase: 'gap' } : state;
    case 'set-gap':
      return state.phase === 'gap' ? { ...state, gap: action.value } : state;
    case 'continue-gap':
      return state.phase === 'gap' && state.gap.trim() ? { ...state, phase: 'checkin' } : state;
    case 'check-in':
      return state.phase === 'checkin' ? { ...state, phase: 'done', checkedIn: true } : state;
  }
}
