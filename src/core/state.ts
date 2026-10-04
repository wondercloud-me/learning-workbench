import {emptyLab,normalizeLab,type LabState} from './lab';
import {readerUrl,READER_HOME} from './reader';
import { normalizeRecords, type UsageRecord } from './usage';
import { tokenCount } from './providers';
import type { ConversationContext } from './context-cache';
import { defaultPreferences, normalizePreferences, type Preferences } from './preferences';
import { defaultVoiceSettings, type VoiceSettings } from './speech';
import type { LearningColumn } from './learning';
import type { SideChat } from './sidechat';
import { normalizeModelLibrary, validateProfile, type ModelLibrary } from './model-library';

export interface AppState {
  lab: LabState;
  reading: {url:string;title:string};
  usageRecords: UsageRecord[];
  contexts: Record<string, ConversationContext>;
  onboarding: { introSeen: boolean; demoCompleted: boolean };
  columns: LearningColumn[];
  sideChats: SideChat[];
  activeColumnId: string | null;
  checkins: Array<{ date: string; columnId: string; note: string }>;
  practice: Array<{ id: string; columnId: string; stepId: string; kind: 'code' | 'debug'; file?: string; content: string; helpLevel: 'independent' | 'hinted' | 'explained'; createdAt: string }>;
  settings: {
    modelLibrary: ModelLibrary;
    provider: 'openai' | 'deepseek' | 'custom';
    baseUrl: string;
    model: string;
    customProtocol: 'responses' | 'chat';
    reminderTime: string;
    reminderDate: string;
    reminderEnabled: boolean;
    voice: VoiceSettings;
    preferences: Preferences;
  };
}

export const emptyState = (): AppState => ({
  lab: emptyLab(),
  reading: {url:READER_HOME,title:"菜鸟教程"},
  onboarding: { introSeen: false, demoCompleted: false },
  usageRecords: [], contexts: {},
  columns: [], sideChats: [], activeColumnId: null, checkins: [], practice: [],
  settings: { modelLibrary: { profiles: [], active: null }, provider: 'openai', baseUrl: '', model: 'gpt-6-sol', customProtocol: 'responses', reminderTime: '20:00', reminderDate: '', reminderEnabled: false, voice: defaultVoiceSettings(), preferences: defaultPreferences() }
});

export function cleanBackup(state: AppState): AppState {
  return validateState(structuredClone(state));
}

export function validateState(value: unknown): AppState {
  const data = record(value);
  if (!data) throw new Error('备份文件格式不正确');
  const settings = record(data.settings);
  if (!Array.isArray(data.columns) || !Array.isArray(data.sideChats) || !Array.isArray(data.checkins) || !settings) throw new Error('备份缺少必要内容');
  const columns = data.columns.map(value => { assertColumn(value); return value; });
  const sideChats = data.sideChats.map(value => { assertSideChat(value); return value; });
  if (!data.checkins.every(value => { const item = record(value); return item && strings(item, ['date', 'columnId', 'note']); })) throw new Error('备份的打卡记录格式不正确');
  const checkins = data.checkins as AppState['checkins'];
  const practice = Array.isArray(data.practice) ? data.practice : [];
  if (!practice.every(value => { const item = record(value); return item && strings(item, ['id', 'columnId', 'stepId', 'content', 'createdAt']) && oneOf(item.kind, ['code', 'debug']) && oneOf(item.helpLevel, helpLevels) && optionalString(item.file); })) throw new Error('备份的实践记录格式不正确');
  const defaults = emptyState();
  let reading=defaults.reading;
  const savedReading = record(data.reading);
  try { if(savedReading)reading={url:readerUrl(savedReading.url as string),title:typeof savedReading.title==='string'?savedReading.title.slice(0,200)||'菜鸟教程':'菜鸟教程'}; } catch {}
  const savedVoice = record(settings.voice);
  const voice: VoiceSettings = {
    autoRead: savedVoice?.autoRead === true,
    rate: typeof savedVoice?.rate === 'number' && [0.75, 1, 1.25, 1.5].includes(savedVoice.rate) ? savedVoice.rate : 1,
    voice: typeof savedVoice?.voice === 'string' ? savedVoice.voice : ''
  };
  const onboarding = record(data.onboarding);
  const legacy = {
    provider: oneOf(settings.provider, ['openai', 'deepseek', 'custom']) ? settings.provider as AppState['settings']['provider'] : defaults.settings.provider,
    baseUrl: safeApiBaseUrl(settings.baseUrl),
    model: typeof settings.model === 'string' ? settings.model : defaults.settings.model,
    customProtocol: oneOf(settings.customProtocol, ['responses', 'chat']) ? settings.customProtocol as AppState['settings']['customProtocol'] : defaults.settings.customProtocol
  };
  // Persist declared fields only. Learner text in the records remains untouched.
  return {
    lab: normalizeLab(data.lab), reading,
    usageRecords: normalizeRecords(data.usageRecords), contexts: normalizeContexts(data.contexts),
    onboarding: { introSeen: onboarding?.introSeen === true, demoCompleted: onboarding?.demoCompleted === true },
    columns, sideChats, activeColumnId: typeof data.activeColumnId === 'string' ? data.activeColumnId : null,
    checkins, practice: practice as AppState['practice'],
    settings: {
      ...legacy,
      modelLibrary: normalizeModelLibrary(settings.modelLibrary, { ...legacy, baseUrl: typeof settings.baseUrl === 'string' ? settings.baseUrl : '', model: typeof settings.model === 'string' ? settings.model : '' }),
      reminderTime: typeof settings.reminderTime === 'string' ? settings.reminderTime : defaults.settings.reminderTime,
      reminderDate: typeof settings.reminderDate === 'string' ? settings.reminderDate : defaults.settings.reminderDate,
      reminderEnabled: settings.reminderEnabled === true,
      voice, preferences: normalizePreferences(settings.preferences)
    }
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
const strings = (value: Record<string, unknown>, keys: string[]) => keys.every(key => typeof value[key] === 'string');
const optionalString = (value: unknown) => value === undefined || typeof value === 'string';
const oneOf = (value: unknown, options: string[]) => typeof value === 'string' && options.includes(value);
const helpLevels = ['independent', 'hinted', 'explained'];
const evidenceLevels = ['待验证', '初步理解', '可独立应用', '稳定掌握'];

function validMessage(value: unknown): boolean {
  const message = record(value);
  return !!message && strings(message, ['id', 'content', 'createdAt']) && oneOf(message.role, ['user', 'assistant'])
    && optionalString(message.model) && optionalString(message.apiProfile)
    && (message.origin === undefined || oneOf(message.origin, ['user', 'assistant', 'sandbox']));
}

function validEvidence(value: unknown): boolean {
  const evidence = record(value);
  if (!evidence || !strings(evidence, ['id', 'stepId', 'answer', 'teachback', 'createdAt']) || !oneOf(evidence.helpLevel, helpLevels)
    || !oneOf(evidence.level, evidenceLevels) || typeof evidence.confirmed !== 'boolean' || !optionalString(evidence.gap)
    || (evidence.gapAddressed !== undefined && typeof evidence.gapAddressed !== 'boolean')) return false;
  const suggestion = record(evidence.suggestion);
  return evidence.suggestion === undefined || !!suggestion && typeof suggestion.reason === 'string' && oneOf(suggestion.level, evidenceLevels);
}

function assertColumn(value: unknown): asserts value is LearningColumn {
  const column = record(value);
  const error = () => { throw new Error('备份的学习栏目格式不正确'); };
  if (!column || !strings(column, ['id', 'title', 'goal', 'createdAt']) || !oneOf(column.phase, ['planning', 'overview', 'study', 'verify', 'teachback', 'remediate', 'complete'])
    || !Number.isSafeInteger(column.currentStepIndex) || (column.currentStepIndex as number) < 0
    || !Array.isArray(column.taughtStepIds) || !column.taughtStepIds.every(id => typeof id === 'string')
    || !Array.isArray(column.messages) || !column.messages.every(validMessage)
    || !Array.isArray(column.evidence) || !column.evidence.every(validEvidence)
    || !optionalString(column.overview) || (column.kind !== undefined && !oneOf(column.kind, ['knowledge', 'project']))) return error();
  const plan = record(column.plan);
  if (column.plan !== null && (!plan || typeof plan.target !== 'string' || !optionalString(plan.confirmedAt)
    || !Array.isArray(plan.steps) || !plan.steps.every(value => { const step = record(value); return step && strings(step, ['id', 'title', 'outcome']) && typeof step.priority === 'number' && Number.isFinite(step.priority) && oneOf(step.status, ['未开始', '学习中', '待验证', '已完成']); }))) return error();
  const pending = record(column.pendingAnswer);
  if (column.pendingAnswer !== undefined && (!pending || !strings(pending, ['text', 'createdAt']) || !oneOf(pending.helpLevel, helpLevels))) return error();
  if (column.source !== undefined) {
    const source = record(column.source), course = record(source?.course);
    if (!source || !course || !strings(course, ['id', 'title', 'description']) || !safeSourceUrl(course.url) || !safeSourceUrl(source.url)
      || typeof source.version !== 'string' || !Array.isArray(source.sectionIds) || !source.sectionIds.every(id => typeof id === 'string')
      || !plan || !Array.isArray(plan.steps) || plan.steps.length !== source.sectionIds.length || plan.steps.some((step, index) => step.id !== (source.sectionIds as string[])[index])) throw new Error('备份的课程绑定不正确');
  }
}

function assertSideChat(value: unknown): asserts value is SideChat {
  const side = record(value), context = record(side?.context), source = record(side?.source);
  if (!side || !strings(side, ['id', 'columnId', 'parentMessageId', 'createdAt']) || !context || !strings(context, ['quote', 'sourceMessage', 'goal'])
    || !Array.isArray(side.messages) || !side.messages.every(validMessage)
    || (side.source !== undefined && (!source || !strings(source, ['url', 'title'])))) throw new Error('备份的辅助对话格式不正确');
}

function safeSourceUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'www.runoob.com' && !url.port && !url.username && !url.password; }
  catch { return false; }
}

function safeApiBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  try {
    validateProfile({ id: 'legacy-api', name: 'API', baseUrl: value, protocol: 'chat', models: ['legacy-model'] });
    return value;
  } catch { return ''; }
}

function normalizeContexts(value: unknown): Record<string,ConversationContext> {
  const result:Record<string,ConversationContext>=Object.create(null);
  if(!value || typeof value!=='object' || Array.isArray(value))return result;
  for(const [id,v] of Object.entries(value as Record<string,any>)){
    if(!v || typeof v!=='object')continue;
    const c:ConversationContext={};const p=v.checkpoint;const last=v.lastInput;
    if(p && typeof p.summary==='string' && p.summary.length<=12800 && typeof p.throughId==='string' && typeof p.createdAt==='string')c.checkpoint={summary:p.summary,throughId:p.throughId,createdAt:p.createdAt};
    if(last && typeof last.profileId==='string' && typeof last.model==='string' && (last.throughId===null || typeof last.throughId==='string'))c.lastInput={profileId:last.profileId,model:last.model,inputTokens:tokenCount(last.inputTokens),throughId:last.throughId,...(last.compactionBlocked===true?{compactionBlocked:true}:{})};
    result[id]=c;
  }
  return result;
}
