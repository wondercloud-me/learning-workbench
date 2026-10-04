import { describe, expect, it, vi } from 'vitest';
import { callModel, endpoint } from '../src/core/providers';
import { reminderDue } from '../src/core/reminders';

describe('model adapters', () => {
  it('selects Responses for OpenAI and Chat Completions for DeepSeek', () => {
    expect(endpoint({ provider: 'openai', baseUrl: '', model: 'x', customProtocol: 'chat' }).url).toBe('https://api.openai.com/v1/responses');
    expect(endpoint({ provider: 'deepseek', baseUrl: '', model: 'x', customProtocol: 'responses' }).url).toBe('https://api.deepseek.com/chat/completions');
  });
  it('extracts Responses text and reports model errors', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: '你好' }] }] }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 }));
    const settings = { provider: 'openai' as const, baseUrl: '', model: 'test', customProtocol: 'responses' as const };
    try {
      expect(await callModel(settings, 'key', 'system', [{ role: 'user', content: 'hi' }])).toBe('你好');
      await expect(callModel(settings, 'key', 'system', [{ role: 'user', content: 'hi' }])).rejects.toThrow('bad key');
    } finally { globalThis.fetch = original; }
  });
  it('reports an offline connection clearly', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline'));
    try { await expect(callModel({ provider: 'deepseek', baseUrl: '', model: 'test', customProtocol: 'chat' }, 'key', '', [])).rejects.toThrow('模型连接失败：offline'); }
    finally { globalThis.fetch = original; }
  });
});

describe('daily reminder', () => {
  const at = new Date(2026, 8, 26, 20, 30);
  it('notifies once only after the chosen time and before checkin', () => {
    expect(reminderDue(at, '20:00', true, null, false)).toBe(true);
    expect(reminderDue(at, '20:00', true, '2026-09-26', false)).toBe(false);
    expect(reminderDue(at, '20:00', true, null, true)).toBe(false);
    expect(reminderDue(at, '21:00', true, null, false)).toBe(false);
    expect(reminderDue(at, '20:00', true, null, false, '2026-09-27')).toBe(false);
  });
});
