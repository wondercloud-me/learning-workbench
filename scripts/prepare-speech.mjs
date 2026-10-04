import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, cp, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { parseSpeechArgs, selectSpeechTarget } from './speech-platforms.mjs';

// Parse and reject unsupported targets before making directories or downloads.
const requested = parseSpeechArgs(process.argv.slice(2));
const target = selectSpeechTarget(requested.platform, requested.arch);
const output = path.resolve('resources/speech', target.folder);
const cache = path.resolve('.cache/speech');
const model = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17';
const sample = path.join(cache, 'zh.wav');
const sampleHash = 'b77f1794fe374a0ba1ee1dc458bfaf9349496cbbfc32780c50ba3c5a7ad8e373';
async function sha(file) { const hash = createHash('sha256'); for await (const part of createReadStream(file)) hash.update(part); return hash.digest('hex'); }
async function matches(file, digest) { try { return await sha(file) === digest; } catch { return false; } }
const expected = {
  [target.executable]: target.executableHash,
  'model.int8.onnx': 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51',
  'tokens.txt': 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc'
};
const archives = [
  { file: target.archive, legacy: target.folder === 'mac-arm64' ? 'runtime.tar.bz2' : '', digest: target.archiveHash, url: target.url, members: [`${target.archiveRoot}/bin/${target.executable}`] },
  { file: `${model}.tar.bz2`, legacy: 'model.tar.bz2', digest: '7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e', url: `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${model}.tar.bz2`, members: [`${model}/model.int8.onnx`, `${model}/tokens.txt`, `${model}/test_wavs/zh.wav`] },
];
await mkdir(path.dirname(output), { recursive: true });
await mkdir(cache, { recursive: true });
const ready = (await Promise.all(Object.entries(expected).map(([file, digest]) => matches(path.join(output, file), digest)))).every(Boolean);
if (!ready || !await matches(sample, sampleHash)) {
  const staging = await mkdtemp(path.join(cache, `prepared-${target.folder}-`));
  try {
    for (const spec of archives) {
      const archive = path.join(cache, spec.file);
      if (!await matches(archive, spec.digest) && spec.legacy && await matches(path.join(cache, spec.legacy), spec.digest)) await cp(path.join(cache, spec.legacy), archive);
      if (!await matches(archive, spec.digest)) {
        const partial = `${archive}.partial`;
        try {
          execFileSync('curl', ['--fail', '--location', '--retry', '2', '--connect-timeout', '15', '--max-time', '600', spec.url, '-o', partial], { stdio: 'inherit' });
          if (!await matches(partial, spec.digest)) throw new Error(`下载校验不通过：${spec.file}`);
          await rename(partial, archive);
        } finally { await rm(partial, { force: true }); }
      }
      const extraction = await mkdtemp(path.join(cache, `extract-${target.folder}-`));
      try {
        execFileSync('tar', ['-xjf', archive, '-C', extraction, ...spec.members]);
        for (const member of spec.members) await cp(path.join(extraction, member), member.endsWith('/zh.wav') ? sample : path.join(staging, path.basename(member)));
      } finally { await rm(extraction, { recursive: true, force: true }); }
    }
    for (const [file, digest] of Object.entries(expected)) if (!await matches(path.join(staging, file), digest)) throw new Error(`模型文件校验失败：${file}`);
    if (!await matches(sample, sampleHash)) throw new Error('语音验收样例校验失败');
    if (target.platform === 'darwin') await chmod(path.join(staging, target.executable), 0o755);
    await rm(output, { recursive: true, force: true });
    await rename(staging, output);
  } finally { await rm(staging, { recursive: true, force: true }); }
}
for (const [file, digest] of Object.entries(expected)) if (!await matches(path.join(output, file), digest)) throw new Error(`模型文件校验失败：${file}`);
if (!await matches(sample, sampleHash)) throw new Error('语音验收样例校验失败');
await writeFile(path.join(output, 'speech-manifest.json'), JSON.stringify({
  platform: target.platform, arch: target.arch, version: target.version, model, files: expected,
  sources: archives.map(({ file, url, digest }) => ({ archive: file, url, sha256: digest })),
}, null, 2) + '\n');
console.log(`语音资源已就绪：${target.folder}（官方来源与 SHA-256 校验通过）`);
