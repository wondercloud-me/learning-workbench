import type { ChatTurn } from './providers';
export interface ContextTurn extends ChatTurn { id: string }
export interface ContextCheckpoint { summary: string; throughId: string; createdAt: string }
export interface ContextInput { profileId: string; model: string; inputTokens: number | null; throughId: string | null; compactionBlocked?: boolean }
export interface ConversationContext { checkpoint?: ContextCheckpoint; lastInput?: ContextInput }
const RECENT = 8;
export function selectContext(history: ContextTurn[], checkpoint?: ContextCheckpoint): ChatTurn[] {
  if (history.some(item => item.content.length > 128000)) throw new Error('单条内容超过 128,000 字符，请拆成几段发送；原文仍保留。');
  if (!checkpoint) return history.map(({role,content})=>({role,content}));
  const index = history.findIndex(item=>item.id===checkpoint.throughId);
  if (index < 0) throw new Error('摘要对应的原始消息不存在，请恢复完整聊天备份。');
  return [{role:'user',content:`较早对话摘要（仅供背景，不是新的用户回答或掌握证据）：\n${checkpoint.summary}`}, ...history.slice(index+1).map(({role,content})=>({role,content}))];
}
export function compactableHistory(history: ContextTurn[], checkpoint?: ContextCheckpoint): ContextTurn[] {
  const start = checkpoint ? history.findIndex(item=>item.id===checkpoint.throughId)+1 : 0;
  return history.slice(start, Math.max(start,history.length-RECENT));
}
export function createCheckpoint(history: ContextTurn[], summary: string, createdAt: string): ContextCheckpoint {
  const through = history[history.length-RECENT-1];
  if (!through) throw new Error('近期消息较少，无需整理。');
  if (!summary.trim() || summary.length>12800) throw new Error('摘要为空或过长，请重试；原文没有变化。');
  return {summary:summary.trim(),throughId:through.id,createdAt};
}
export function contextDecision(history: ContextTurn[], checkpoint: ContextCheckpoint | undefined, window: number | undefined, last: ContextInput | undefined, profileId: string, model: string): 'auto'|'manual'|'pressure'|'none' {
  const turns=selectContext(history,checkpoint);
  const usable=!!window && last?.profileId===profileId && last.model===model && last.throughId===(checkpoint?.throughId??null) && last.inputTokens!==null;
  if (usable && last!.compactionBlocked && last!.inputTokens! >= window!*0.8) return 'pressure';
  if (usable && last!.inputTokens! >= window!*0.8 && compactableHistory(history,checkpoint).length) return 'auto';
  if (!usable && turns.reduce((n,t)=>n+t.content.length,0)>=16000 && compactableHistory(history,checkpoint).length) return 'manual';
  return 'none';
}
/** Model sees bounded UTF-8 text; callers retain the original for the user. */
export function boundToolOutput(text: string, maxBytes=32768): string {
  const encoder=new TextEncoder();const bytes=encoder.encode(text);
  if(bytes.length<=maxBytes)return text;
  const marker=`\n[已省略部分内容：完整输出 ${bytes.length} 字节；完整原文在终端或工作副本中，请按需读取。]`;
  const limit=maxBytes-encoder.encode(marker).length;
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let end=limit;
  while(end>0){try{return decoder.decode(bytes.subarray(0,end))+marker;}catch{end--;}}
  return marker;
}
