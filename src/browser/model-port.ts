import {resolveModel, validateProfile, type ApiProfile, type ModelLibrary, type ModelSelection} from '../core/model-library';
import {callModel, callModelDetailed} from '../core/providers';
import {ModelRuntime, type ModelSnapshot} from '../node/model-runtime';

function browserProfile(input: ApiProfile): ApiProfile {
  const profile = validateProfile(input);
  if (new URL(profile.baseUrl).protocol !== 'https:') throw new Error('浏览器模型地址必须使用 HTTPS');
  return profile;
}

/** Keys belong only to this page lifetime. No document or storage adapter receives them. */
export class BrowserModelPort {
  #runtime: ModelRuntime;

  constructor(transport: typeof fetch = (...args) => globalThis.fetch(...args)) {
    const browserFetch: typeof fetch = (url, init) => transport(url, {...init, credentials: 'omit'});
    this.#runtime = new ModelRuntime(
      (settings, key, system, turns, signal) => callModel(settings, key, system, turns, signal, browserFetch),
      (settings, key, system, turns, signal) => callModelDetailed(settings, key, system, turns, signal, browserFetch)
    );
  }

  setKey(profile: ApiProfile, key: string): void {this.#runtime.setKey(browserProfile(profile), key);}
  hasKey(profile: ApiProfile): boolean {
    try {return this.#runtime.hasKey(browserProfile(profile));} catch {return false;}
  }
  forgetKey(id: string): void {this.#runtime.forgetKey(id);}
  clearKeys(): void {this.#runtime.clearKeys();}
  snapshot(library: ModelLibrary, selected?: ModelSelection): ModelSnapshot {
    const resolved = resolveModel(library, selected);
    browserProfile(resolved.profile);
    const snapshot = this.#runtime.snapshot(library, selected);
    // The runtime request already captures private settings/key copies; copy all
    // public metadata too so context-window decisions cannot drift after acceptance.
    return {...snapshot, profile: structuredClone(snapshot.profile), settings: {...snapshot.settings}};
  }
}
