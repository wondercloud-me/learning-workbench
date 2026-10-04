export interface ChatTurn { role: 'user' | 'assistant' | 'system'; content: string }
export interface ProviderSettings { provider: 'openai' | 'deepseek' | 'custom'; baseUrl: string; model: string; customProtocol: 'responses' | 'chat' }

export function endpoint(settings: ProviderSettings): { url: string; protocol: 'responses' | 'chat' } {
  const protocol = settings.provider === 'openai' ? 'responses' : settings.provider === 'deepseek' ? 'chat' : settings.customProtocol;
  const base = (settings.baseUrl.trim() || (settings.provider === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.openai.com/v1')).replace(/\/$/, '');
  return { url: `${base}/${protocol === 'responses' ? 'responses' : 'chat/completions'}`, protocol };
}

export async function callModelDetailed(settings: ProviderSettings, key: string, system: string, turns: ChatTurn[], signal?: AbortSignal, transport: typeof fetch = fetch): Promise<ModelReply> {
  if (!key) throw new Error('先在设置中保存 API Key');
  if (!settings.model.trim()) throw new Error('请填写模型名称');
  const { url, protocol } = endpoint(settings);
  const body = protocol === 'responses'
    ? { model: settings.model, instructions: system, input: turns.filter(turn => turn.role !== 'system').map(turn => ({ role: turn.role, content: turn.content })) }
    : { model: settings.model, messages: [{ role: 'system', content: system }, ...turns] };
  let response: Response;
  try {
    response = await transport(url, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  } catch (error) {
    throw new Error(`模型连接失败：${error instanceof Error ? error.message : String(error)}`);
  }
  const raw = await response.text();
  let data: any;
  try { data = JSON.parse(raw); } catch { throw new Error(`模型返回无法解析：${raw.slice(0, 160)}`); }
  const usage = normalizeUsage(data.usage, protocol);
  if (!response.ok) throw new ModelResponseError(`模型报错 (${response.status})：${data.error?.message || raw.slice(0, 200)}`, usage);
  const output = protocol === 'responses'
    ? (data.output_text || data.output?.flatMap((item: any) => item.content || []).filter((item: any) => item.type === 'output_text').map((item: any) => item.text).join('\n'))
    : data.choices?.[0]?.message?.content;
  if (typeof output !== 'string' || !output.trim()) throw new ModelResponseError('模型没有返回文本', usage);
  return { text: output.trim(), usage };
}

export interface ModelUsage {
  inputTokens: number | null; cachedInputTokens: number | null; uncachedInputTokens: number | null;
  cacheWriteTokens: number | null; outputTokens: number | null;
}
export interface ModelReply { text: string; usage: ModelUsage | null }
export const tokenCount = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
export function normalizeUsage(value: any, protocol: 'responses' | 'chat'): ModelUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const inputTokens = tokenCount(protocol === 'responses' ? value.input_tokens : value.prompt_tokens);
  const details = protocol === 'responses' ? value.input_tokens_details : value.prompt_tokens_details;
  let cachedInputTokens = tokenCount(value.prompt_cache_hit_tokens ?? details?.cached_tokens ?? value.cache_read_input_tokens);
  if (inputTokens !== null && cachedInputTokens !== null && cachedInputTokens > inputTokens) cachedInputTokens = null;
  const reportedMiss = tokenCount(value.prompt_cache_miss_tokens);
  const uncachedInputTokens = reportedMiss ?? (inputTokens !== null && cachedInputTokens !== null ? inputTokens - cachedInputTokens : null);
  return { inputTokens, cachedInputTokens, uncachedInputTokens, cacheWriteTokens: tokenCount(details?.cache_write_tokens ?? value.cache_creation_input_tokens), outputTokens: tokenCount(protocol === 'responses' ? value.output_tokens : value.completion_tokens) };
}
export async function callModel(settings: ProviderSettings, key: string, system: string, turns: ChatTurn[], signal?: AbortSignal, transport: typeof fetch = fetch): Promise<string> {
  return (await callModelDetailed(settings, key, system, turns, signal, transport)).text;
}

export class ModelResponseError extends Error {
  constructor(message:string, readonly usage:ModelUsage|null){super(message);this.name='ModelResponseError';}
}
