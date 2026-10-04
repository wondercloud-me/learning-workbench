import { emptyState, cleanBackup, type AppState } from './state';
import { labTask, normalizeLab, sameJson, type LabMode, type LabRun, type LabState } from './lab';

export type LabDraft = { explanation: string; lastRun: LabRun | null; updatedAt: string };
export type BrowserDrafts = {
  lab: Record<string, LabDraft>;
  messages: Record<string, string>;
  references: Record<string, { url: string; text: string; providedAt: string }>;
};
export type BrowserDocument = { state: AppState; drafts: BrowserDrafts };
export type BrowserSnapshot = { schemaVersion: 1; revision: number; updatedAt: string; document: BrowserDocument };

export const emptyBrowserDocument = (): BrowserDocument => ({
  state: emptyState(), drafts: { lab: {}, messages: {}, references: {} }
});

type Parser = (value: unknown, path: string) => unknown;
type Shape = Record<string, Parser>;
const invalid = (path: string): never => { throw new Error(`备份的 ${path} 格式不正确`); };
const string: Parser = (value, path) => typeof value === 'string' ? value : invalid(path);
const boolean: Parser = (value, path) => typeof value === 'boolean' ? value : invalid(path);
const number: Parser = (value, path) => typeof value === 'number' && Number.isFinite(value) ? value : invalid(path);
const integer: Parser = (value, path) => Number.isSafeInteger(value) && (value as number) >= 0 ? value : invalid(path);
const choice = (...values: (string | number)[]): Parser => (value, path) => values.includes(value as string | number) ? value : invalid(path);
const nullable = (parse: Parser): Parser => (value, path) => value === null ? null : parse(value, path);
const optional = (parse: Parser): Parser => (value, path) => value === undefined ? undefined : parse(value, path);
const array = (parse: Parser): Parser => (value, path) => Array.isArray(value) ? Array.from(value, (item, index) => parse(item, `${path}[${index}]`)) : invalid(path);
const object = (shape: Shape): Parser => (value, path) => {
  const source = requireRecord(value, path);
  return Object.fromEntries(Object.entries(shape).flatMap(([key, parse]) => {
    const result = parse(source[key], `${path}.${key}`);
    return result === undefined ? [] : [[key, result]];
  }));
};
const dictionary = (parse: Parser): Parser => (value, path) => Object.fromEntries(
  Object.entries(requireRecord(value, path)).map(([key, item]) => [key, parse(item, `${path}.${key}`)])
);
const bounded = (max: number): Parser => (value, path) => typeof value === 'string' && value.length <= max ? value : invalid(path);
const date: Parser = (value, path) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? value : invalid(path);
const help = choice('independent', 'hinted', 'explained');
const level = choice('待验证', '初步理解', '可独立应用', '稳定掌握');
const mode = choice('practice', 'transfer');
const json: Parser = (value, path) => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return number(value, path);
  if (Array.isArray(value)) return array(json)(value, path);
  return dictionary(json)(value, path);
};
const check = object({ label: bounded(200), passed: boolean, expected: json, actual: optional(json), input: optional(array(json)), error: optional(bounded(1000)) });
const runShape: Shape = { code: bounded(20000), taskId: string, checks: array(check), logs: array(bounded(4000)), error: bounded(1000) };
const run = object(runShape);
const session = object({ unitId: string, mode, learnedAt: date, code: bounded(20000), hintsSeen: integer, helpLevel: help });
const attempt = object({ ...runShape, id: string, unitId: string, mode, helpLevel: help, explanation: string, passed: boolean, createdAt: date });
const message = object({ id: string, role: choice('user', 'assistant'), content: string, createdAt: string, origin: optional(choice('user', 'assistant', 'sandbox')), model: optional(string), apiProfile: optional(string) });
const evidence = object({ id: string, stepId: string, answer: string, teachback: string, helpLevel: help, level, confirmed: boolean,
  suggestion: optional(object({ level, reason: string })), gap: optional(string), gapAddressed: optional(boolean), createdAt: string });
const step = object({ id: string, title: string, outcome: string, priority: number, status: choice('未开始', '学习中', '待验证', '已完成') });
const column = object({ id: string, title: string, goal: string, createdAt: string, kind: optional(choice('knowledge', 'project')),
  phase: choice('planning', 'overview', 'study', 'verify', 'teachback', 'remediate', 'complete'), currentStepIndex: integer,
  taughtStepIds: array(string), messages: array(message), evidence: array(evidence), overview: optional(string),
  plan: nullable(object({ target: string, confirmedAt: optional(string), steps: array(step) })),
  pendingAnswer: optional(object({ text: string, createdAt: string, helpLevel: help })),
  source: optional(object({ course: object({ id: string, title: string, description: string, url: string }), url: string, version: string, sectionIds: array(string) })) });
const sideChat = object({ id: string, columnId: string, parentMessageId: string, createdAt: string, messages: array(message),
  context: object({ quote: string, sourceMessage: string, goal: string }), source: optional(object({ url: string, title: string })) });
const usage = object({ id: string, createdAt: string, profileId: string, model: string, purpose: choice('chat', 'side', 'summary', 'agent', 'test'),
  usage: nullable(object({ inputTokens: nullable(integer), cachedInputTokens: nullable(integer), uncachedInputTokens: nullable(integer), cacheWriteTokens: nullable(integer), outputTokens: nullable(integer) })) });
const context = object({ checkpoint: optional(object({ summary: bounded(12800), throughId: string, createdAt: string })),
  lastInput: optional(object({ profileId: string, model: string, inputTokens: nullable(integer), throughId: nullable(string), compactionBlocked: optional(boolean) })) });
const preferences = object({ name: string, goal: string, customInstructions: string, dailyMinutes: choice(30, 60, 90, 120, 150, 180),
  theme: choice('system', 'light', 'dark'), fontSize: choice(12, 13, 14, 15, 16, 17, 18), codeSize: choice(11, 12, 13, 14, 15, 16, 17, 18, 19, 20),
  sendKey: choice('enter', 'mod-enter'), closeToTray: boolean, defaultMode: choice('coach', 'study-coach', 'grill'), wordWrap: boolean,
  lineNumbers: boolean, minimap: boolean, tabSize: choice(2, 4, 8), replyStyle: choice('concise', 'balanced', 'detailed') });
const stateParser = object({
  lab: object({ sessions: dictionary(session), attempts: array(attempt) }), reading: object({ url: string, title: string }),
  onboarding: object({ introSeen: boolean, demoCompleted: boolean }), columns: array(column), sideChats: array(sideChat), activeColumnId: nullable(string),
  checkins: array(object({ date: string, columnId: string, note: string })),
  practice: array(object({ id: string, columnId: string, stepId: string, kind: choice('code', 'debug'), file: optional(string), content: string, helpLevel: help, createdAt: string })),
  usageRecords: array(usage), contexts: dictionary(context), settings: object({
    provider: choice('openai', 'deepseek', 'custom'), baseUrl: string, model: string, customProtocol: choice('responses', 'chat'),
    reminderTime: string, reminderDate: string, reminderEnabled: boolean, voice: object({ autoRead: boolean, rate: choice(0.75, 1, 1.25, 1.5), voice: string }),
    preferences, modelLibrary: object({ profiles: array(object({ id: string, name: string, baseUrl: string, protocol: choice('responses', 'chat'), models: array(string), contextWindows: optional(dictionary(integer)) })),
      active: nullable(object({ profileId: string, model: string })) })
  })
});

export function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid(path);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid(path);
  return value as Record<string, unknown>;
}

function taskForKey(key: string, path: string): { unitId: string; mode: LabMode } {
  const parts = key.split(':');
  if (parts.length !== 2 || (parts[1] !== 'practice' && parts[1] !== 'transfer')) return invalid(path);
  try { labTask(parts[0], parts[1]); } catch { return invalid(path); }
  return { unitId: parts[0], mode: parts[1] };
}

function assertLab(lab: LabState): void {
  for (const [key, item] of Object.entries(lab.sessions)) {
    const task = taskForKey(key, `state.lab.sessions.${key}`);
    if (item.unitId !== task.unitId || item.mode !== task.mode) invalid(`state.lab.sessions.${key}`);
  }
  const normalized = normalizeLab(lab);
  if (!sameJson(lab.sessions, normalized.sessions) || lab.attempts.length !== normalized.attempts.length) invalid('state.lab');
  lab.attempts.forEach((item, index) => {
    // Normalization also bounds checks, JSON depth/node count and log output. Its
    // computed pass result must agree, rather than certifying imported evidence.
    if (item.passed !== normalized.attempts[index].passed) invalid(`state.lab.attempts[${index}].passed`);
  });
}

function validateDrafts(value: unknown): BrowserDrafts {
  const source = requireRecord(value, 'drafts');
  const lab = Object.fromEntries(Object.entries(requireRecord(source.lab, 'drafts.lab')).map(([key, value]) => {
    const task = taskForKey(key, `drafts.lab.${key}`);
    const draft = object({ explanation: bounded(20000), lastRun: nullable(run), updatedAt: date })(value, `drafts.lab.${key}`) as LabDraft;
    if (draft.lastRun) {
      const probe = normalizeLab({ sessions: {}, attempts: [{ ...draft.lastRun, ...task, id: 'draft-validation', helpLevel: 'independent', explanation: '仅作结构验证不保存', passed: false, createdAt: draft.updatedAt }] });
      if (probe.attempts.length !== 1) invalid(`drafts.lab.${key}.lastRun`);
    }
    return [key, draft];
  }));
  const references = dictionary(object({ url: bounded(2048), text: bounded(50000), providedAt: date }))(source.references, 'drafts.references') as BrowserDrafts['references'];
  for (const [key, reference] of Object.entries(references)) {
    try {
      const url = new URL(reference.url);
      if (url.protocol !== 'https:' || url.username || url.password) invalid(`drafts.references.${key}.url`);
    } catch { invalid(`drafts.references.${key}.url`); }
  }
  return { lab, messages: dictionary(bounded(20000))(source.messages, 'drafts.messages') as BrowserDrafts['messages'], references };
}

/** Current documents are strict. Only the old plain AppState import migrates. */
export function validateBrowserDocument(value: unknown): BrowserDocument {
  const document = requireRecord(value, 'document');
  const state = stateParser(document.state, 'state') as AppState;
  assertLab(state.lab);
  // Reuse the desktop whitelist and semantic validation, but retain raw learner
  // text: legacy preference/reading display limits must not truncate backups.
  const normalized = cleanBackup(state);
  normalized.lab = state.lab;
  normalized.settings.preferences.name = state.settings.preferences.name;
  normalized.settings.preferences.goal = state.settings.preferences.goal;
  normalized.settings.preferences.customInstructions = state.settings.preferences.customInstructions;
  normalized.reading.title = state.reading.title;
  for (const [key, item] of Object.entries(state.contexts)) {
    if (item.lastInput?.compactionBlocked === false && normalized.contexts[key]?.lastInput) normalized.contexts[key].lastInput!.compactionBlocked = false;
  }
  if (!sameJson(state, normalized)) invalid('state（当前版本不能归一化或丢失记录）');
  return { state, drafts: validateDrafts(document.drafts) };
}
