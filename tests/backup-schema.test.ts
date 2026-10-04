import { describe, expect, it } from 'vitest';
import { createColumn, type LearningColumn } from '../src/core/learning';
import { createLessonColumn } from '../src/core/course-learning';
import { beginLab, setLabCode } from '../src/core/lab';
import { createSideChat } from '../src/core/sidechat';
import { cleanBackup, emptyState, validateState } from '../src/core/state';
import { usageRecord } from '../src/core/usage';
import { practiceUnits } from '../src/data/practice-units';

const now = '2026-10-05T10:00:00.000Z';
const rawText = 'const apiKey = "example-only";\nconst token = input.token;\n// 保留我自己的代码和解释';
const column = (): LearningColumn => ({
  ...createColumn('后端', '能读懂并调整接口', now, 'c'),
  phase: 'remediate',
  plan: { target: '读懂请求', confirmedAt: now, steps: [{ id: 'step', title: '请求', outcome: '运行接口', priority: 1, status: '学习中' }] },
  taughtStepIds: ['step'],
  messages: [{ id: 'message', role: 'user', content: rawText, createdAt: now }],
  evidence: [{ id: 'e', stepId: 'step', answer: rawText, teachback: rawText, helpLevel: 'hinted', level: '初步理解', confirmed: true, createdAt: now, gap: 'token 读取失败', gapAddressed: true }],
  overview: rawText
});
const sideChat = () => ({
  ...createSideChat({ id: 's', columnId: 'c', parentMessageId: 'message', selectedText: 'apiKey', sourceMessage: rawText, columnGoal: rawText, now }),
  messages: [{ id: 'side-message', role: 'user' as const, content: rawText, createdAt: now }]
});

describe('backup schema boundaries', () => {
  it.each(['import', 'export'] as const)('drops unknown configuration and top-level fields during %s', operation => {
    const original = emptyState();
    const dirty = {
      ...original,
      apiKey: 'configured-top-key', token: 'configured-top-token', secrets: { password: 'configured-password' },
      configuration: { headers: { Authorization: 'Bearer configured-header' } },
      settings: {
        ...original.settings,
        apiKey: 'configured-settings-key', token: 'configured-settings-token', authorization: 'configured-authorization',
        providerHeaders: { 'X-Key': 'configured-header-key' },
        modelLibrary: {
          profiles: [{ id: 'p', name: 'API', baseUrl: 'https://api.example.com/v1', protocol: 'chat' as const, models: ['m'], apiKey: 'configured-profile-key' }],
          active: { profileId: 'p', model: 'm', token: 'configured-selection-token' },
          apiKey: 'configured-library-key'
        }
      }
    };
    const restored = operation === 'export' ? cleanBackup(dirty) : validateState(dirty);
    expect(Object.keys(restored).sort()).toEqual(['activeColumnId', 'checkins', 'columns', 'contexts', 'lab', 'onboarding', 'practice', 'reading', 'settings', 'sideChats', 'usageRecords']);
    expect(Object.keys(restored.settings).sort()).toEqual(['baseUrl', 'customProtocol', 'model', 'modelLibrary', 'preferences', 'provider', 'reminderDate', 'reminderEnabled', 'reminderTime', 'voice']);
    expect(JSON.stringify(restored)).not.toContain('configured-');
    expect(restored.settings.modelLibrary.profiles).toEqual([{ id: 'p', name: 'API', baseUrl: 'https://api.example.com/v1', protocol: 'chat', models: ['m'] }]);
    expect(dirty.settings.apiKey).toBe('configured-settings-key');
  });

  it('retains exact learner code, conversations, evidence and existing reading/usage/context/lab state', () => {
    const original = emptyState();
    original.columns = [column()];
    original.sideChats = [sideChat()];
    original.activeColumnId = 'c';
    original.checkins = [{ date: '2026-10-05', columnId: 'c', note: rawText }];
    original.practice = [{ id: 'practice', columnId: 'c', stepId: 'step', kind: 'code', content: rawText, helpLevel: 'independent', createdAt: now }];
    original.reading = { url: 'https://www.runoob.com/python3/python3-loop.html', title: '循环' };
    original.usageRecords = [usageRecord('p', 'm', 'chat', { inputTokens: 10, cachedInputTokens: 0, uncachedInputTokens: 10, cacheWriteTokens: null, outputTokens: 3 }, now, 'u')];
    original.contexts = { c: { checkpoint: { summary: rawText, throughId: 'message', createdAt: now }, lastInput: { profileId: 'p', model: 'm', inputTokens: 10, throughId: 'message', compactionBlocked: true } } };
    original.settings.preferences.customInstructions = rawText;
    original.lab = setLabCode(beginLab(original.lab, practiceUnits[0].id, 'practice', now), practiceUnits[0].id, 'practice', rawText);
    const restored = validateState(cleanBackup(original));
    expect(restored).toEqual(original);
    expect(restored.columns[0].messages[0].content).toBe(rawText);
    expect(restored.sideChats[0].context.sourceMessage).toBe(rawText);
    expect(restored.lab.sessions[`${practiceUnits[0].id}:practice`].code).toBe(rawText);
  });

  it('migrates a minimal old backup while retaining its learning records and legacy model', () => {
    const old = {
      columns: [createColumn('旧栏目', '旧目标', 'now', 'old')], sideChats: [], checkins: [],
      settings: { provider: 'deepseek', baseUrl: '', model: 'deepseek-flash', customProtocol: 'responses', reminderTime: '18:30', reminderEnabled: true }
    };
    const restored = validateState(old);
    expect(restored.columns).toEqual(old.columns);
    expect(restored.lab).toEqual({ sessions: {}, attempts: [] });
    expect(restored.reading).toEqual({ url: 'https://www.runoob.com/', title: '菜鸟教程' });
    expect(restored.onboarding).toEqual({ introSeen: false, demoCompleted: false });
    expect(restored.usageRecords).toEqual([]);
    expect(restored.contexts).toEqual({});
    expect(restored.practice).toEqual([]);
    expect(restored.activeColumnId).toBeNull();
    expect(restored.settings.reminderDate).toBe('');
    expect(restored.settings.reminderTime).toBe('18:30');
    expect(restored.settings.reminderEnabled).toBe(true);
    expect(restored.settings.modelLibrary).toEqual({ profiles: [{ id: 'legacy-api', name: 'DeepSeek（原有配置）', baseUrl: 'https://api.deepseek.com', protocol: 'chat', models: ['deepseek-flash'] }], active: { profileId: 'legacy-api', model: 'deepseek-flash' } });
  });

  it('defaults malformed optional configuration fields instead of exposing them to the UI', () => {
    const original = emptyState();
    const restored = validateState({ ...original, activeColumnId: {}, settings: { provider: {}, baseUrl: null, model: 42, customProtocol: 'wrong', reminderTime: [], reminderDate: {}, reminderEnabled: 'true' } });
    expect(restored.activeColumnId).toBeNull();
    expect(restored.settings.provider).toBe('openai');
    expect(restored.settings.baseUrl).toBe('');
    expect(restored.settings.model).toBe('gpt-6-sol');
    expect(restored.settings.customProtocol).toBe('responses');
    expect(restored.settings.reminderTime).toBe('20:00');
    expect(restored.settings.reminderDate).toBe('');
    expect(restored.settings.reminderEnabled).toBe(false);
  });

  it.each([
    'https://user:configured-password@api.example.com/v1',
    'https://api.example.com/v1?api_key=configured-query-key',
    'https://api.example.com/v1#configured-fragment'
  ])('does not persist credentials embedded in the legacy API address: %s', baseUrl => {
    const dirty = { ...emptyState(), settings: { provider: 'custom', baseUrl, model: 'm', customProtocol: 'chat' } };
    const restored = validateState(dirty);
    expect(restored.settings.baseUrl).toBe('');
    expect(restored.settings.modelLibrary).toEqual({ profiles: [], active: null });
    expect(JSON.stringify(restored)).not.toContain('configured-');
  });

  it('rejects malformed checkins and practice records before rendering learner content', () => {
    expect(() => validateState({ ...emptyState(), checkins: [null] })).toThrow(/备份.*打卡/);
    expect(() => validateState({ ...emptyState(), practice: [{ id: 'p', columnId: 'c', stepId: 'step', kind: 'code', content: {}, helpLevel: 'independent', createdAt: now }] })).toThrow(/备份.*实践/);
  });

  it.each([
    { label: 'null column', value: null },
    { label: 'missing title', value: { ...column(), title: undefined } },
    { label: 'missing phase', value: { ...column(), phase: undefined } },
    { label: 'unknown phase', value: { ...column(), phase: 'unknown' } },
    { label: 'missing messages', value: { ...column(), messages: undefined } },
    { label: 'invalid message content', value: { ...column(), messages: [{ id: 'm', role: 'user', content: {}, createdAt: now }] } },
    { label: 'missing evidence', value: { ...column(), evidence: undefined } },
    { label: 'invalid evidence text', value: { ...column(), evidence: [{ ...column().evidence[0], answer: {} }] } },
    { label: 'invalid step index', value: { ...column(), currentStepIndex: -1 } },
    { label: 'missing taught steps', value: { ...column(), taughtStepIds: null } },
    { label: 'missing plan steps', value: { ...column(), plan: { target: '目标' } } },
    { label: 'invalid plan step title', value: { ...column(), plan: { target: '目标', steps: [{ id: 'x', title: {}, outcome: '运行', priority: 1, status: '学习中' }] } } }
  ])('rejects malformed learning fields before rendering: $label', ({ value }) => {
    expect(() => validateState({ ...emptyState(), columns: [value] })).toThrow(/备份.*栏目/);
  });

  it.each([
    { label: 'null side chat', value: null },
    { label: 'missing identifier', value: { ...sideChat(), id: undefined } },
    { label: 'missing column identifier', value: { ...sideChat(), columnId: undefined } },
    { label: 'missing parent identifier', value: { ...sideChat(), parentMessageId: undefined } },
    { label: 'missing context', value: { ...sideChat(), context: null } },
    { label: 'invalid context quote', value: { ...sideChat(), context: { quote: {}, sourceMessage: rawText, goal: rawText } } },
    { label: 'missing messages', value: { ...sideChat(), messages: undefined } },
    { label: 'invalid message role', value: { ...sideChat(), messages: [{ id: 'm', role: 'system', content: rawText, createdAt: now }] } }
  ])('rejects malformed side chat fields before rendering: $label', ({ value }) => {
    expect(() => validateState({ ...emptyState(), sideChats: [value] })).toThrow(/备份.*辅助对话/);
  });

  it('rejects a lesson binding whose section list is longer than the retained plan', () => {
    const lesson = createLessonColumn({ id: 'python', title: 'Python3', description: '', url: 'https://www.runoob.com/python3/python3-tutorial.html' }, { url: 'https://www.runoob.com/python3/python3-loop.html', title: '循环', version: 'v1', fetchedAt: now, sections: [{ id: 'while', title: 'while', blocks: [] }, { id: 'for', title: 'for', blocks: [] }] }, now, 'lesson');
    lesson.plan!.steps.pop();
    expect(() => validateState({ ...emptyState(), columns: [lesson] })).toThrow(/备份.*课程绑定/);
  });
});
