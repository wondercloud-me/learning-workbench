import { describe, expect, it } from 'vitest';
import { normalizeModelLibrary, removeProfile, resolveModel, selectModel, upsertProfile, validateProfile, type ApiProfile, type ModelLibrary } from '../src/core/model-library';

const a: ApiProfile = { id: 'a', name: '接口 A', baseUrl: 'https://a.example/v1', protocol: 'responses', models: ['a-small', 'a-large'] };
const b: ApiProfile = { id: 'b', name: '接口 B', baseUrl: 'https://b.example', protocol: 'chat', models: ['b-chat'] };
const library = (): ModelLibrary => ({ profiles: [{ ...a, models: [...a.models] }, { ...b, models: [...b.models] }], active: { profileId: 'a', model: 'a-small' } });

describe('model profile persistence and selection', () => {
  it('migrates an existing single provider without persisting keys', () => {
    const migrated = normalizeModelLibrary(undefined, { provider: 'deepseek', baseUrl: '', model: 'kept-model', customProtocol: 'responses' });
    expect(migrated.profiles).toEqual([{ id: 'legacy-api', name: 'DeepSeek（原有配置）', baseUrl: 'https://api.deepseek.com', protocol: 'chat', models: ['kept-model'] }]);
    expect(migrated.active).toEqual({ profileId: 'legacy-api', model: 'kept-model' });
    expect(normalizeModelLibrary({ profiles: [], active: null }, { provider: 'openai', baseUrl: '', model: 'legacy', customProtocol: 'responses' })).toEqual({ profiles: [], active: null });
  });

  it('cleans untrusted restored profiles and recovers a missing active model', () => {
    const result = normalizeModelLibrary({ profiles: [{ ...a, apiKey: 'must-never-survive', models: [' a-small ', 'a-small', 'a-large'] }, { ...b, id: 'a' }, { ...b, baseUrl: 'file:///tmp/private' }, b], active: { profileId: 'deleted', model: 'old', apiKey: 'bad' }, apiKey: 'bad' });
    expect(result).toEqual({ profiles: [a, b], active: { profileId: 'a', model: 'a-small' } });
    expect(JSON.stringify(result)).not.toContain('apiKey');
    expect(normalizeModelLibrary({ profiles: [null, {}, { ...a, models: [] }] })).toEqual({ profiles: [], active: null });
  });

  it('normalizes pasted full endpoints while rejecting ambiguous or credential-bearing addresses', () => {
    expect(validateProfile({ ...a, name: '  工作  ', baseUrl: 'https://EXAMPLE.com:443/v1/responses/', models: [' x ', 'x', 'y'] })).toEqual({ ...a, name: '工作', baseUrl: 'https://example.com/v1', models: ['x', 'y'] });
    expect(validateProfile({ ...b, baseUrl: 'http://localhost:8080/v1/chat/completions' }).baseUrl).toBe('http://localhost:8080/v1');
    for (const baseUrl of ['file:///tmp/model', 'https://user:secret@example.com/v1', 'https://example.com/v1?key=secret', 'https://example.com/v1#private', 'not-a-url']) {
      expect(() => validateProfile({ ...a, baseUrl })).toThrow();
    }
    expect(() => validateProfile({ ...a, name: ' ' })).toThrow();
    expect(() => validateProfile({ ...a, models: [' ', ''] })).toThrow();
  });

  it('routes each model to its selected profile and rejects a stale selection', () => {
    const selected = selectModel(library(), { profileId: 'b', model: 'b-chat' });
    expect(resolveModel(selected)).toEqual({ profile: b, settings: { provider: 'custom', baseUrl: 'https://b.example', model: 'b-chat', customProtocol: 'chat' } });
    expect(resolveModel(selected, { profileId: 'a', model: 'a-large' }).settings.model).toBe('a-large');
    expect(() => selectModel(selected, { profileId: 'b', model: 'a-small' })).toThrow();
    expect(() => resolveModel(selected, { profileId: 'gone', model: 'a-small' })).toThrow();
    expect(() => resolveModel({ profiles: [], active: null })).toThrow();
  });

  it('updates and removes profiles without mutating earlier snapshots', () => {
    const original = library();
    const updated = upsertProfile(original, { ...a, models: ['replacement'] });
    expect(updated.profiles).toHaveLength(2);
    expect(updated.active).toEqual({ profileId: 'a', model: 'replacement' });
    expect(original.profiles[0].models).toEqual(['a-small', 'a-large']);
    const removed = removeProfile(updated, 'a');
    expect(removed).toEqual({ profiles: [b], active: { profileId: 'b', model: 'b-chat' } });
    expect(removeProfile(removed, 'b')).toEqual({ profiles: [], active: null });
    expect(upsertProfile({ profiles: [], active: null }, b).active).toEqual({ profileId: 'b', model: 'b-chat' });
  });

  it('keeps the same API when its selected model is removed but another model remains', () => {
    const source: ModelLibrary = { profiles: [a, { ...b, models: ['flash', 'pro'] }], active: { profileId: 'b', model: 'flash' } };
    const updated = upsertProfile(source, { ...b, models: ['pro'] });
    expect(updated.active).toEqual({ profileId: 'b', model: 'pro' });
    expect(normalizeModelLibrary({ ...updated, active: { profileId: 'b', model: 'removed' } }).active).toEqual({ profileId: 'b', model: 'pro' });
    expect(removeProfile(updated, 'b').active).toEqual({ profileId: 'a', model: 'a-small' });
  });
});
