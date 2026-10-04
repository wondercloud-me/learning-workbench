import type { LearningColumn,Message } from './learning';

export interface SideChat {
  source?:{url:string;title:string};
  id: string;
  columnId: string;
  parentMessageId: string;
  context: { quote: string; sourceMessage: string; goal: string };
  messages: Message[];
  createdAt: string;
}

export function createSideChat(input: { id: string; columnId: string; parentMessageId: string; selectedText: string; sourceMessage: string; columnGoal: string; now: string }): SideChat {
  const quote = input.selectedText.trim();
  if (!quote || !input.sourceMessage.includes(quote)) throw new Error('选中文字必须来自当前消息');
  return { id: input.id, columnId: input.columnId, parentMessageId: input.parentMessageId,
    context: { quote, sourceMessage: input.sourceMessage, goal: input.columnGoal }, messages: [], createdAt: input.now };
}

export function carrySideChatConclusion(side: SideChat, conclusion: string): string {
  if (!conclusion.trim()) throw new Error('没有可带回的结论');
  return `关于「${side.context.quote}」，辅助对话得出的结论：\n${conclusion.trim()}`;
}

export function carryToTeachingDraft(side:SideChat,conclusion:string,columns:LearningColumn[],drafts:Record<string,string>){const target=columns.find(c=>c.id===side.columnId);if(!target)throw new Error('原教学栏目已不存在，请重新打开对应章节');return {target,drafts:{...drafts,[target.id]:carrySideChatConclusion(side,conclusion)}};}
