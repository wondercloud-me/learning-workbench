import { afterEach, describe, expect, it, vi } from 'vitest';
import { callModelDetailed } from '../src/core/providers';
import { ModelRuntime } from '../src/node/model-runtime';
const settings = { provider: 'custom' as const, baseUrl: 'http://localhost:8000', model: 'm', customProtocol: 'responses' as const };
afterEach(() => vi.unstubAllGlobals());
const response = (data: unknown) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(data))));
describe('reported usage', () => {
  it('returns Responses text and inclusive input/cache/output in one fetch', async () => {
    response({output_text:'hi',usage:{input_tokens:100,input_tokens_details:{cached_tokens:80},output_tokens:12}});
    const r=await callModelDetailed(settings,'key','fixed',[]);
    expect(r).toEqual({text:'hi',usage:{inputTokens:100,cachedInputTokens:80,uncachedInputTokens:20,cacheWriteTokens:null,outputTokens:12}});
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('reads DeepSeek hit/miss without counting hits twice', async () => {
    response({choices:[{message:{content:'hello'}}],usage:{prompt_tokens:120,prompt_cache_hit_tokens:90,prompt_cache_miss_tokens:30,completion_tokens:8}});
    expect((await callModelDetailed({...settings,customProtocol:'chat'},'key','',[])).usage).toEqual({inputTokens:120,cachedInputTokens:90,uncachedInputTokens:30,cacheWriteTokens:null,outputTokens:8});
  });
  it('distinguishes compatible Chat reported zero from missing', async () => {
    response({choices:[{message:{content:'x'}}],usage:{prompt_tokens:10,prompt_tokens_details:{cached_tokens:0},completion_tokens:0}});
    expect((await callModelDetailed({...settings,customProtocol:'chat'},'key','',[])).usage?.cachedInputTokens).toBe(0);
    response({output_text:'x'});
    expect((await callModelDetailed(settings,'key','',[])).usage).toBeNull();
    response({output_text:'x',usage:{input_tokens:10,input_tokens_details:{cached_tokens:-1},output_tokens:'2'}});
    expect((await callModelDetailed(settings,'key','',[])).usage).toEqual({inputTokens:10,cachedInputTokens:null,uncachedInputTokens:null,cacheWriteTokens:null,outputTokens:null});
  });
  it('detailed snapshots redact keys in errors and remain bound to selection', async () => {
    response({error:{message:'private-key'} });
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{message:'private-key'}}),{status:401})));
    const p={id:'a',name:'A',baseUrl:settings.baseUrl,protocol:'responses' as const,models:['m']};
    const runtime=new ModelRuntime();runtime.setKey(p,'private-key');
    await expect(runtime.snapshot({profiles:[p],active:{profileId:'a',model:'m'}}).chatDetailed('',[])).rejects.toThrow('[已隐藏 API Key]');
  });
});
