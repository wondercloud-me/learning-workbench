import { describe, expect, it } from 'vitest';
import { ModelRuntime } from '../src/node/model-runtime';
import type { ApiProfile, ModelLibrary } from '../src/core/model-library';
import type { callModel } from '../src/core/providers';

const a: ApiProfile = { id: 'a', name: 'A', baseUrl: 'https://a.example/v1', protocol: 'responses', models: ['small', 'large'] };
const b: ApiProfile = { id: 'b', name: 'B', baseUrl: 'https://b.example', protocol: 'chat', models: ['chat'] };
const library = (): ModelLibrary => ({ profiles: [{ ...a, models: [...a.models] }, { ...b, models: [...b.models] }], active: { profileId: 'a', model: 'small' } });
const route: typeof callModel = async (settings, key) => `${settings.baseUrl}|${settings.customProtocol}|${settings.model}|${key}`;

describe('per-profile model key routing', () => {
  it('uses exactly the selected profile key and protocol', async () => {
    const runtime = new ModelRuntime(route);
    runtime.setKey(a, 'key-a');
    runtime.setKey(b, 'key-b');
    expect(await runtime.chat(library(), { profileId: 'a', model: 'large' }, '', [])).toBe('https://a.example/v1|responses|large|key-a');
    expect(await runtime.chat(library(), { profileId: 'b', model: 'chat' }, '', [])).toBe('https://b.example|chat|chat|key-b');
    runtime.forgetKey('a');
    await expect(runtime.chat(library(), { profileId: 'a', model: 'small' }, '', [])).rejects.toThrow(/API Key/);
    expect(runtime.hasKey(b)).toBe(true);
  });

  it('binds a key to a normalized address and protocol while permitting renames', async () => {
    const runtime = new ModelRuntime(route);
    runtime.setKey({ ...a, baseUrl: 'https://A.example:443/v1/responses/' }, 'key-a');
    expect(runtime.hasKey({ ...a, name: 'renamed', models: ['other'] })).toBe(true);
    for (const changed of [{ ...a, baseUrl: 'https://untrusted.example/v1' }, { ...a, protocol: 'chat' as const }]) {
      expect(runtime.hasKey(changed)).toBe(false);
      await expect(runtime.chat({ profiles: [changed], active: { profileId: 'a', model: 'small' } }, undefined, '', [])).rejects.toThrow(/API Key/);
    }
    runtime.clearKeys();
    expect(runtime.hasKey(a)).toBe(false);
    expect(() => runtime.setKey(a, '   ')).toThrow();
  });

  it('keeps an ongoing agent snapshot fixed across edits and key replacement', async () => {
    const runtime = new ModelRuntime(route);
    const source = library();
    runtime.setKey(a, 'original-key');
    const snapshot = runtime.snapshot(source);
    source.profiles[0].baseUrl = 'https://changed.example';
    source.profiles[0].models[0] = 'changed-model';
    source.active = { profileId: 'b', model: 'chat' };
    runtime.setKey(a, 'new-key');
    runtime.clearKeys();
    snapshot.settings.baseUrl = 'https://mutated-return.example';
    snapshot.profile.models[0] = 'mutated-return';
    expect(await snapshot.chat('system', [{ role: 'user', content: 'hello' }])).toBe('https://a.example/v1|responses|small|original-key');
    expect(JSON.stringify(snapshot)).not.toContain('original-key');
  });

  it('redacts a server error that echoes the request key', async () => {
    const runtime = new ModelRuntime(async (_settings, key) => { throw new Error(`rejected ${key}; again ${key}`); });
    runtime.setKey(a, 'private-key');
    await expect(runtime.chat(library(), undefined, '', [])).rejects.toThrow('rejected [已隐藏 API Key]; again [已隐藏 API Key]');
  });

  it('passes an independent request body and abort signal to the provider', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const controller = new AbortController();
    const runtime = new ModelRuntime(async (settings, _key, system, turns, signal) => {
      await gate;
      return `${settings.model}|${system}|${turns[0].content}|${signal === controller.signal}`;
    });
    runtime.setKey(a, 'key-a');
    const source = library();
    const turns = [{ role: 'user' as const, content: 'original question' }];
    const pending = runtime.chat(source, undefined, 'original system', turns, controller.signal);
    turns[0].content = 'changed question';
    source.active!.model = 'large';
    release();
    expect(await pending).toBe('small|original system|original question|true');
  });
});
