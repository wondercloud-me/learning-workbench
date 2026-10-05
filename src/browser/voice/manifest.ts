import resources from './resources.json';

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {Object.values(value).forEach(freeze); Object.freeze(value);}
  return value;
}
export const VOICE_RESOURCES = freeze(resources);
export type VoiceResourceRole = 'glue' | 'wasm' | 'wrapper' | 'model' | 'tokens' | 'worker' | 'worklet';
export interface VoiceResource {
  readonly role: VoiceResourceRole;
  readonly filename: string;
  readonly url: string;
  readonly downloadUrl: string;
  readonly bytes: number;
  readonly sha256: string;
}
export interface VoiceManifest {
  readonly schemaVersion: 1;
  readonly buildId: string;
  readonly basePath: string;
  readonly modelKind: 'senseVoice';
  readonly runtimeVersion: '1.13.8';
  readonly files: readonly VoiceResource[];
}
const roles: readonly VoiceResourceRole[] = ['glue','wasm','wrapper','model','tokens','worker','worklet'];
const invalid = () => new Error('本地语音资源清单的版本、来源或校验元数据不匹配。');
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
};
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  if (Object.keys(value).length !== keys.length || keys.some(key => !(key in value))) throw invalid();
};

/** Validate untrusted deployment JSON before handing it to the resource store. */
export function validateVoiceManifest(value: unknown, baseUrl: string): VoiceManifest {
  if (!baseUrl.startsWith('/')) {
    const absolute = new URL(baseUrl);
    if (!['https:','http:'].includes(absolute.protocol) || absolute.username || absolute.password || absolute.search || absolute.hash) throw invalid();
    baseUrl = absolute.pathname;
  }
  const item = record(value);
  exactKeys(item, ['schemaVersion','buildId','basePath','modelKind','runtimeVersion','files']);
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(baseUrl) || typeof item.buildId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(item.buildId)
    || item.schemaVersion !== 1 || item.modelKind !== 'senseVoice' || item.runtimeVersion !== resources.runtime.version
    || item.basePath !== `${baseUrl}${resources.pathPrefix}${resources.runtime.version}/${item.buildId}/`
    || !Array.isArray(item.files) || item.files.length !== roles.length) throw invalid();
  const files = item.files.map((value, index): VoiceResource => {
    const file = record(value); exactKeys(file, ['role','filename','url','downloadUrl','bytes','sha256']);
    const role = roles[index]; const pinned = resources.files.find(file => file.role === role);
    const filename = pinned?.filename ?? (role === 'worker' ? 'runtime.worker.js' : 'capture.worklet.js');
    const url = item.basePath + filename;
    if (file.role !== role || file.filename !== filename || file.url !== url || typeof file.bytes !== 'number' || !Number.isSafeInteger(file.bytes) || file.bytes <= 0
      || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)
      || (pinned && (file.bytes !== pinned.bytes || file.sha256 !== pinned.sha256))
      || (file.downloadUrl !== url + '?wb-asr-download=1' && (!(role === 'model' || role === 'tokens') || file.downloadUrl !== pinned?.source))) throw invalid();
    return {role,filename,url,downloadUrl:file.downloadUrl as string,bytes:file.bytes,sha256:file.sha256};
  });
  return freeze({schemaVersion:1,buildId:item.buildId,basePath:item.basePath as string,modelKind:'senseVoice',runtimeVersion:'1.13.8',files});
}

/** This exact field/role order is shared with prepare and the SW allowlist digest. */
export function voiceManifestJson(manifest: VoiceManifest): string {
  return JSON.stringify({schemaVersion:manifest.schemaVersion,buildId:manifest.buildId,basePath:manifest.basePath,modelKind:manifest.modelKind,runtimeVersion:manifest.runtimeVersion,
    files:manifest.files.map(file => ({role:file.role,filename:file.filename,url:file.url,downloadUrl:file.downloadUrl,bytes:file.bytes,sha256:file.sha256}))});
}
