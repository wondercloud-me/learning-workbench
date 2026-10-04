import { callModel, callModelDetailed, ModelResponseError, type ModelReply, type ChatTurn, type ProviderSettings } from '../core/providers';
import { resolveModel, validateProfile, type ApiProfile, type ModelLibrary, type ModelSelection } from '../core/model-library';

export interface ModelSnapshot {
  profile: ApiProfile;
  settings: ProviderSettings;
  chatDetailed(system: string, turns: ChatTurn[], signal?: AbortSignal): Promise<ModelReply>;
  chat(system: string, turns: ChatTurn[], signal?: AbortSignal): Promise<string>;
}

function binding(profile: ApiProfile): string {
  return JSON.stringify([profile.baseUrl, profile.protocol]);
}

/** API keys live in the main process, never in persisted libraries or renderer state. */
export class ModelRuntime {
  private readonly keys = new Map<string, { binding: string; key: string }>();

  constructor(private readonly request: typeof callModel = callModel, private readonly detailedRequest: typeof callModelDetailed = callModelDetailed) {}

  setKey(input: ApiProfile, key: string): void {
    const profile = validateProfile(input);
    if (typeof key !== 'string' || !key.trim()) throw new Error('请填写 API Key');
    this.keys.set(profile.id, { binding: binding(profile), key: key.trim() });
  }

  hasKey(input: ApiProfile): boolean {
    try {
      const profile = validateProfile(input);
      const saved = this.keys.get(profile.id);
      return !!saved && saved.binding === binding(profile);
    } catch { return false; }
  }

  forgetKey(id: string): void { this.keys.delete(id); }
  clearKeys(): void { this.keys.clear(); }

  snapshot(library: ModelLibrary, selected?: ModelSelection): ModelSnapshot {
    const { profile, settings } = resolveModel(library, selected);
    const saved = this.keys.get(profile.id);
    if (!saved || saved.binding !== binding(profile)) throw new Error(`请先为「${profile.name}」保存 API Key`);
    const key = saved.key;
    // Keep closure copies separate from the public metadata to prevent later mutation.
    const fixedSettings = { ...settings };
    return {
      profile: { ...profile, models: [...profile.models] },
      settings: { ...settings },
      chatDetailed: async (system, turns, signal) => {
        try { return await this.detailedRequest({ ...fixedSettings }, key, system, turns.map(({ role, content }) => ({ role, content })), signal); }
        catch (error) { const message=(error instanceof Error ? error.message : String(error)).split(key).join('[已隐藏 API Key]'); throw error instanceof ModelResponseError?new ModelResponseError(message,error.usage):new Error(message); }
      },
      chat: async (system, turns, signal) => {
        try {
          return await this.request({ ...fixedSettings }, key, system, turns.map(({ role, content }) => ({ role, content })), signal);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(message.split(key).join('[已隐藏 API Key]'));
        }
      },
    };
  }

  async chat(library: ModelLibrary, selected: ModelSelection | undefined, system: string, turns: ChatTurn[], signal?: AbortSignal): Promise<string> {
    return this.snapshot(library, selected).chat(system, turns, signal);
  }
}
