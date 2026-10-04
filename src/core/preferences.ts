export interface Preferences {
  name: string; goal: string; dailyMinutes: number;
  theme: 'system' | 'light' | 'dark'; fontSize: number; codeSize: number;
  sendKey: 'enter' | 'mod-enter'; closeToTray: boolean; defaultMode: 'coach' | 'study-coach' | 'grill';
  wordWrap: boolean; lineNumbers: boolean; minimap: boolean; tabSize: number;
  customInstructions: string; replyStyle: 'concise' | 'balanced' | 'detailed';
}
export const defaultPreferences = (): Preferences => ({ name: '学习者', goal: '', dailyMinutes: 120, theme: 'system', fontSize: 14, codeSize: 13, sendKey: 'enter', closeToTray: true, defaultMode: 'coach', wordWrap: true, lineNumbers: true, minimap: false, tabSize: 2, customInstructions: '', replyStyle: 'balanced' });
export function normalizePreferences(input: unknown): Preferences {
  const d = defaultPreferences(), v = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const text = (key: keyof Preferences, max: number) => typeof v[key] === 'string' ? (v[key] as string).slice(0, max) : d[key] as string;
  const choice = <T extends string | number>(key: keyof Preferences, values: T[], fallback: T) => values.includes(v[key] as T) ? v[key] as T : fallback;
  const bool = (key: keyof Preferences) => typeof v[key] === 'boolean' ? v[key] as boolean : d[key] as boolean;
  return { name: text('name', 40), goal: text('goal', 1000), dailyMinutes: choice('dailyMinutes',[30,60,90,120,150,180],120), theme: choice('theme',['system','light','dark'],'system'), fontSize: choice('fontSize',[12,13,14,15,16,17,18],14), codeSize: choice('codeSize',[11,12,13,14,15,16,17,18,19,20],13), sendKey: choice('sendKey',['enter','mod-enter'],'enter'), closeToTray: bool('closeToTray'), defaultMode: choice('defaultMode',['coach','study-coach','grill'],'coach'), wordWrap: bool('wordWrap'), lineNumbers: bool('lineNumbers'), minimap: bool('minimap'), tabSize: choice('tabSize',[2,4,8],2), customInstructions: text('customInstructions',6000), replyStyle: choice('replyStyle',['concise','balanced','detailed'],'balanced') };
}
export function shouldSend(event: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; isComposing: boolean }, setting: Preferences['sendKey']) {
  return event.key === 'Enter' && !event.isComposing && !event.shiftKey && (setting === 'enter' || event.metaKey || event.ctrlKey);
}
export function personalInstruction(p: Preferences) {
  return `用户的学习目标：${p.goal || '以当前栏目为准'}。每日可用时间约 ${p.dailyMinutes} 分钟；这是整体预算，不额外安排必须完成的任务。表达偏好：${({concise:'简短，保留关键步骤',balanced:'解释清楚，长度适中',detailed:'详细解释机制与步骤'})[p.replyStyle]}。\n用户补充的教学偏好：${p.customInstructions || '无'}。\n继续遵守先学后评估、只认用户实际产出、一次推进一步的规则。`;
}
