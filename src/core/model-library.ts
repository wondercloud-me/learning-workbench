import type { ProviderSettings } from './providers';

export interface ApiProfile {
  id: string;
  name: string;
  baseUrl: string;
  protocol: 'responses' | 'chat';
  models: string[];
  contextWindows?: Record<string, number>;
}

export interface ModelSelection { profileId: string; model: string }
export interface ModelLibrary { profiles: ApiProfile[]; active: ModelSelection | null }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Returns only persisted, non-secret fields, including when the input came from a backup. */
export function validateProfile(input: ApiProfile): ApiProfile {
  const value = record(input);
  const id = typeof value?.id === 'string' ? value.id.trim() : '';
  const name = typeof value?.name === 'string' ? value.name.trim() : '';
  if (!id) throw new Error('API 配置缺少标识');
  if (!name) throw new Error('请填写 API 配置名称');
  if (value?.protocol !== 'responses' && value?.protocol !== 'chat') throw new Error('请选择 Responses 或 Chat Completions 协议');
  let url: URL;
  try { url = new URL(typeof value.baseUrl === 'string' ? value.baseUrl.trim() : ''); }
  catch { throw new Error('请填写完整的 API 地址，例如 https://api.example.com/v1'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('API 地址只支持 HTTP 或 HTTPS');
  if (url.username || url.password || url.search || url.hash) throw new Error('API 地址不能包含用户名、密码、查询参数或片段；请单独填写 API Key');
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/(?:responses|chat\/completions)$/, '');
  const baseUrl = url.toString().replace(/\/+$/, '');
  const models = Array.isArray(value.models)
    ? [...new Set(value.models.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean))]
    : [];
  if (!models.length) throw new Error('请至少填写一个模型名称');
  const windows = record(value.contextWindows);
  const contextWindows = Object.fromEntries(models.filter(model => typeof windows?.[model] === 'number' && Number.isSafeInteger(windows[model]) && (windows[model] as number) >= 256 && (windows[model] as number) <= 10000000).map(model => [model, windows![model] as number]));
  return { id, name, baseUrl, protocol: value.protocol, models, ...(Object.keys(contextWindows).length ? {contextWindows} : {}) };
}

function selection(value: unknown): ModelSelection | null {
  const source = record(value);
  return typeof source?.profileId === 'string' && typeof source.model === 'string'
    ? { profileId: source.profileId, model: source.model }
    : null;
}

function validSelection(profiles: ApiProfile[], active: ModelSelection | null): active is ModelSelection {
  return !!active && profiles.some(profile => profile.id === active.profileId && profile.models.includes(active.model));
}

function withActive(profiles: ApiProfile[], active: ModelSelection | null): ModelLibrary {
  const fallback = profiles.find(profile => profile.id === active?.profileId) ?? profiles[0];
  return { profiles, active: validSelection(profiles, active)
    ? { ...active }
    : fallback ? { profileId: fallback.id, model: fallback.models[0] } : null };
}

/** Missing libraries migrate once; an explicitly empty library stays empty after deletion. */
export function normalizeModelLibrary(value: unknown, legacy?: ProviderSettings): ModelLibrary {
  const source = record(value);
  if (!source || !Object.prototype.hasOwnProperty.call(source, 'profiles')) {
    if (!legacy) return { profiles: [], active: null };
    const protocol = legacy.provider === 'openai' ? 'responses' : legacy.provider === 'deepseek' ? 'chat' : legacy.customProtocol;
    const name = legacy.provider === 'openai' ? 'OpenAI' : legacy.provider === 'deepseek' ? 'DeepSeek' : '自定义 API';
    try {
      const profile = validateProfile({ id: 'legacy-api', name: `${name}（原有配置）`, baseUrl: legacy.baseUrl?.trim() || (legacy.provider === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.openai.com/v1'), protocol, models: [legacy.model] });
      return withActive([profile], null);
    } catch { return { profiles: [], active: null }; }
  }
  const profiles: ApiProfile[] = [];
  const ids = new Set<string>();
  for (const item of Array.isArray(source.profiles) ? source.profiles : []) {
    try {
      const profile = validateProfile(item as ApiProfile);
      if (!ids.has(profile.id)) { profiles.push(profile); ids.add(profile.id); }
    } catch { /* An invalid restored profile cannot be used for requests. */ }
  }
  return withActive(profiles, selection(source.active));
}

/** A request never silently switches to another profile when its selection is stale. */
export function resolveModel(library: ModelLibrary, selected?: ModelSelection): { profile: ApiProfile; settings: ProviderSettings } {
  const active = selected ?? library.active;
  if (!active) throw new Error('请先添加 API 配置并选择模型');
  const found = library.profiles.find(profile => profile.id === active.profileId);
  if (!found) throw new Error('所选 API 配置已不存在，请重新选择模型');
  const profile = validateProfile(found);
  if (!profile.models.includes(active.model)) throw new Error('所选模型已不在该 API 配置中，请重新选择模型');
  return { profile, settings: { provider: 'custom', baseUrl: profile.baseUrl, model: active.model, customProtocol: profile.protocol } };
}

export function upsertProfile(library: ModelLibrary, input: ApiProfile): ModelLibrary {
  const profile = validateProfile(input);
  const current = normalizeModelLibrary(library);
  const exists = current.profiles.some(item => item.id === profile.id);
  const profiles = exists ? current.profiles.map(item => item.id === profile.id ? profile : item) : [...current.profiles, profile];
  return withActive(profiles, current.active);
}

export function removeProfile(library: ModelLibrary, id: string): ModelLibrary {
  const current = normalizeModelLibrary(library);
  return withActive(current.profiles.filter(profile => profile.id !== id), current.active);
}

export function selectModel(library: ModelLibrary, selected: ModelSelection): ModelLibrary {
  resolveModel(library, selected);
  const current = normalizeModelLibrary(library);
  return { profiles: current.profiles, active: { profileId: selected.profileId, model: selected.model } };
}
