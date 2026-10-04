import { describe, expect, it } from 'vitest';
import { createBackup, readBackup } from '../src/core/backup';
import { emptyBrowserDocument, validateBrowserDocument, type BrowserDocument } from '../src/core/browser-state';
import { createColumn } from '../src/core/learning';
import { beginLab, setLabCode, type LabRun } from '../src/core/lab';

const now = '2026-10-05T10:00:00.000Z';
const text = '  const apiKey = "API Key";\nconst token = input.token;\n// Authorization 是我自己的学习正文。  ';
const failedRun = (): LabRun => ({ code: text, taskId: 'greeting', checks: [{ label: '普通名字', passed: false, input: ['小林'], expected: '你好，小林', actual: null, error: '没有返回' }], logs: ['API Key'], error: 'ReferenceError: input is not defined' });
function fullDocument(): BrowserDocument {
  const document = emptyBrowserDocument();
  const state = document.state;
  state.lab = setLabCode(beginLab(state.lab, 'functions', 'practice', now), 'functions', 'practice', text);
  state.lab.sessions['functions:practice'].hintsSeen = 1;
  state.lab.sessions['functions:practice'].helpLevel = 'explained';
  state.lab.attempts = [{ ...failedRun(), id: 'attempt', unitId: 'functions', mode: 'practice', helpLevel: 'explained', explanation: text, passed: false, createdAt: now }];
  state.columns = [{ ...createColumn('后端', '能写接口', now, 'column'), phase: 'remediate',
    plan: { target: text, confirmedAt: now, steps: [{ id: 'step', title: '请求', outcome: text, priority: 1, status: '待验证' }] },
    taughtStepIds: ['step'], overview: text, pendingAnswer: { text, helpLevel: 'hinted', createdAt: now },
    messages: [{ id: 'message', role: 'user', content: text, createdAt: now, origin: 'user', model: 'm', apiProfile: 'p' }],
    evidence: [{ id: 'evidence', stepId: 'step', answer: text, teachback: text, helpLevel: 'hinted', level: '初步理解', confirmed: true, createdAt: now, gap: text, gapAddressed: false, suggestion: { level: '待验证', reason: text } }] }];
  state.sideChats = [{ id: 'side', columnId: 'column', parentMessageId: 'message', createdAt: now,
    context: { quote: 'API Key', sourceMessage: text, goal: text }, source: { url: 'https://www.runoob.com/', title: text },
    messages: [{ id: 'side-message', role: 'assistant', content: text, createdAt: now, origin: 'assistant' }] }];
  state.activeColumnId = 'column';
  state.checkins = [{ date: '2026-10-05', columnId: 'column', note: text }];
  state.practice = [{ id: 'practice', columnId: 'column', stepId: 'step', kind: 'debug', file: 'test.js', content: text, helpLevel: 'independent', createdAt: now }];
  state.reading = { url: 'https://www.runoob.com/python3/python3-loop.html', title: '循环' };
  state.onboarding = { introSeen: true, demoCompleted: true };
  state.usageRecords = [{ id: 'usage', profileId: 'p', model: 'm', purpose: 'summary', createdAt: now,
    usage: { inputTokens: 12, cachedInputTokens: 10, uncachedInputTokens: 2, cacheWriteTokens: null, outputTokens: 3 } }];
  state.contexts = { column: { checkpoint: { summary: text, throughId: 'message', createdAt: now }, lastInput: { profileId: 'p', model: 'm', inputTokens: 12, throughId: 'message', compactionBlocked: true } } };
  state.settings.preferences.customInstructions = text;
  state.settings.modelLibrary = { profiles: [{ id: 'p', name: 'API', baseUrl: 'https://api.example.com/v1', protocol: 'chat', models: ['m'], contextWindows: { m: 16000 } }], active: { profileId: 'p', model: 'm' } };
  document.drafts = { lab: { 'functions:practice': { explanation: text, lastRun: failedRun(), updatedAt: now } },
    messages: { column: text, 'side:side': text }, references: { column: { url: 'https://example.com/reference', text, providedAt: now } } };
  return document;
}

describe('browser document and versioned backup', () => {
  it('roundTripsEveryDeclaredLearningFieldAndDraft', () => {
    const document = fullDocument();
    const backup = createBackup(document, '0.9.0', now);
    expect(backup).toMatchObject({ format: 'growth-workbench', schemaVersion: 1, appVersion: '0.9.0', exportedAt: now });
    expect(readBackup(JSON.parse(JSON.stringify(backup)))).toEqual(document);
    expect(document.state.columns[0].evidence[0].level).toBe('初步理解');
    expect(document.state.lab.attempts[0].passed).toBe(false);
  });

  it('acceptsPlainDesktopStateWithEmptyDrafts', () => {
    const state = fullDocument().state;
    expect(readBackup(state)).toEqual({ state, drafts: { lab: {}, messages: {}, references: {} } });
    const legacy = { columns: [], sideChats: [], checkins: [], settings: {} };
    expect(readBackup(legacy).state.lab).toEqual({ sessions: {}, attempts: [] });
    expect(readBackup(legacy).drafts).toEqual({ lab: {}, messages: {}, references: {} });
  });

  it('rejectsFutureSchema', () => {
    expect(() => readBackup({ ...createBackup(fullDocument(), '0.9.0', now), schemaVersion: 2 })).toThrow(/未来|不支持.*版本/);
  });

  it('dropsOnlyUndeclaredCredentialConfiguration', () => {
    const dirty: any = fullDocument();
    dirty.state.apiKey = 'configured-top-key';
    dirty.state.settings.apiKey = 'configured-settings-key';
    dirty.state.settings.modelLibrary.profiles[0].token = 'configured-profile-token';
    dirty.state.columns[0].messages[0].authorization = 'configured-message-header';
    dirty.drafts.apiKey = 'configured-draft-key';
    dirty.drafts.lab['functions:practice'].lastRun.authorization = 'configured-run-header';
    dirty.drafts.references.column.token = 'configured-reference-token';
    const backup = createBackup(dirty, '0.9.0', now);
    expect(JSON.stringify(backup)).not.toContain('configured-');
    expect(readBackup(backup)).toEqual(fullDocument());
    expect(dirty.state.settings.apiKey).toBe('configured-settings-key');
  });

  it('retains saved learner text beyond the new draft limits', () => {
    const document = fullDocument();
    const long = text.repeat(400);
    document.state.columns[0].messages[0].content = long;
    document.state.sideChats[0].messages[0].content = long;
    document.state.lab.attempts[0].explanation = long;
    document.state.settings.preferences.name = long;
    document.state.settings.preferences.goal = long;
    document.state.settings.preferences.customInstructions = long;
    document.state.reading.title = long;
    expect(readBackup(createBackup(document, '0.9.0', now))).toEqual(document);
  });

  it.each([
    ['missing state field', (d: any) => { delete d.state.lab; }],
    ['malformed lab session', (d: any) => { d.state.lab.sessions['functions:practice'].code = null; }],
    ['mismatched session key', (d: any) => { d.state.lab.sessions['functions:transfer'] = d.state.lab.sessions['functions:practice']; }],
    ['malformed saved attempt', (d: any) => { d.state.lab.attempts[0].checks[0].passed = 'false'; }],
    ['wrong saved task', (d: any) => { d.state.lab.attempts[0].taskId = 'missing'; }],
    ['fabricated passed flag', (d: any) => { d.state.lab.attempts[0].passed = true; }],
    ['invalid usage', (d: any) => { d.state.usageRecords[0].usage.inputTokens = -1; }],
    ['duplicate usage', (d: any) => { d.state.usageRecords.push(d.state.usageRecords[0]); }],
    ['invalid context', (d: any) => { d.state.contexts.column.checkpoint.summary = 42; }],
    ['invalid preferences', (d: any) => { d.state.settings.preferences.dailyMinutes = '120'; }],
    ['invalid model profile', (d: any) => { d.state.settings.modelLibrary.profiles[0].baseUrl = 'https://user:secret@example.com'; }],
    ['invalid draft unit', (d: any) => { d.drafts.lab['unknown:practice'] = d.drafts.lab['functions:practice']; }],
    ['invalid draft mode', (d: any) => { d.drafts.lab['functions:unknown'] = d.drafts.lab['functions:practice']; }],
    ['wrong draft task', (d: any) => { d.drafts.lab['functions:practice'].lastRun.taskId = 'other'; }],
    ['non-finite run value', (d: any) => { d.drafts.lab['functions:practice'].lastRun.checks[0].actual = Infinity; }],
    ['oversized logs', (d: any) => { d.drafts.lab['functions:practice'].lastRun.logs = ['x'.repeat(4001)]; }],
    ['invalid draft timestamp', (d: any) => { d.drafts.lab['functions:practice'].updatedAt = 'now'; }],
    ['oversized explanation', (d: any) => { d.drafts.lab['functions:practice'].explanation = 'x'.repeat(20001); }],
    ['oversized message', (d: any) => { d.drafts.messages.column = 'x'.repeat(20001); }],
    ['oversized reference', (d: any) => { d.drafts.references.column.text = 'x'.repeat(50001); }],
    ['oversized reference url', (d: any) => { d.drafts.references.column.url = 'https://example.com/' + 'x'.repeat(2048); }],
    ['non-https reference', (d: any) => { d.drafts.references.column.url = 'javascript:alert(1)'; }],
    ['invalid reference timestamp', (d: any) => { d.drafts.references.column.providedAt = 'now'; }]
  ])('rejects %s instead of dropping records or truncating text', (_name, mutate) => {
    const document = fullDocument();
    mutate(document);
    expect(() => validateBrowserDocument(document)).toThrow();
    expect(() => readBackup({ format: 'growth-workbench', schemaVersion: 1, appVersion: '0.9.0', exportedAt: now, state: document.state, browser: { drafts: document.drafts } })).toThrow();
  });

  it('accepts draft boundaries and preserves null feedback', () => {
    const document = fullDocument();
    document.drafts.lab['functions:practice'] = { explanation: 'x'.repeat(20000), lastRun: null, updatedAt: now };
    document.drafts.messages.column = 'x'.repeat(20000);
    document.drafts.references.column = { text: 'x'.repeat(50000), url: 'https://example.com/' + 'x'.repeat(2028), providedAt: now };
    expect(validateBrowserDocument(document)).toEqual(document);
  });

  it('rejects malformed version envelopes before treating them as old state', () => {
    const backup = createBackup(fullDocument(), '0.9.0', now);
    for (const patch of [{ format: 'other' }, { schemaVersion: '1' }, { appVersion: null }, { exportedAt: 'now' }, { browser: null }]) {
      expect(() => readBackup({ ...backup, ...patch })).toThrow();
    }
  });

  it('retains the old lab migration policy only for plain desktop states', () => {
    const state: any = fullDocument().state;
    state.lab.attempts.push({ id: 'broken', code: null });
    expect(readBackup(state).state.lab.attempts).toHaveLength(1);
    expect(state.lab.attempts).toHaveLength(2);
  });

  it('rejects sparse record arrays rather than accepting missing records', () => {
    const document = fullDocument();
    document.state.lab.attempts.length = 2;
    expect(() => validateBrowserDocument(document)).toThrow(/备份/);
    const sparseMessages = fullDocument();
    sparseMessages.state.columns[0].messages.length = 2;
    expect(() => validateBrowserDocument(sparseMessages)).toThrow(/备份/);
  });
});
