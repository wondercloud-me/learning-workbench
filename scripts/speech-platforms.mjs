// Platform metadata is shared by resource preparation and the desktop runtime.
const version = '1.13.8';
const targets = {
  'darwin/arm64': {
    folder: 'mac-arm64', asset: 'osx-arm64-static-no-tts', executable: 'sherpa-onnx-offline',
    archiveHash: '1038a379fff5365b684e05cbbb9ab3577c1a2f6b1736a4d53a6746860d7eddd4',
    executableHash: 'ca3d7e369eecc2e640ed1dc751ed598add5c22987b6d68b1c887e94d9fadabca',
  },
  'darwin/x64': {
    folder: 'mac-x64', asset: 'osx-x64-static-no-tts', executable: 'sherpa-onnx-offline',
    archiveHash: '3a6d8782d43de418a22404dd0032ec5ca2e3d049618b43a32100de25c09c392c',
    executableHash: 'a716b8e4f2ae9756437ebfd83f01c8508e67f92596d583e46007d2b33fd2a0d8',
  },
  'win32/x64': {
    folder: 'win-x64', asset: 'win-x64-static-MT-Release-no-tts', executable: 'sherpa-onnx-offline.exe',
    archiveHash: 'd2ce464a9e28d9128ab1fd15720df6f0e5e19053f725035d630af20a09c17e36',
    executableHash: 'de366889e8cf3cde93121f2d11296749769c8624995030a44b86316f8b0c6779',
  },
};

export function selectSpeechTarget(platform, arch) {
  const spec = targets[`${platform}/${arch}`];
  if (!spec) throw new Error(`语音引擎不支持目标 ${platform}/${arch}；可选 macOS arm64、macOS x64、Windows x64`);
  const archiveRoot = `sherpa-onnx-v${version}-${spec.asset}`;
  return { ...spec, platform, arch, version, archiveRoot, archive: `${archiveRoot}.tar.bz2`,
    url: `https://github.com/k2-fsa/sherpa-onnx/releases/download/v${version}/${archiveRoot}.tar.bz2` };
}

export function parseSpeechArgs(args, host = { platform: process.platform, arch: process.arch }) {
  const target = { platform: host.platform, arch: host.arch };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--' && index === 0) continue;
    const match = argument.match(/^--(platform|arch)(?:=(.*))?$/);
    if (!match) throw new Error(`未知语音准备参数：${argument}`);
    const key = match[1];
    if (seen.has(key)) throw new Error(`语音准备参数重复：--${key}`);
    const value = match[2] ?? args[++index];
    if (!value || value.startsWith('--')) throw new Error(`语音准备参数缺少值：--${key}`);
    target[key] = value;
    seen.add(key);
  }
  selectSpeechTarget(target.platform, target.arch);
  return target;
}
