"use strict";
(() => {
  // src/browser/voice/resources.json
  var resources_default = {
    schemaVersion: 1,
    namespace: "growth-workbench-optional-asr-v1",
    pathPrefix: "optional-asr/",
    runtime: {
      version: "1.13.8",
      archive: {
        url: "https://pub.dev/api/archives/sherpa_onnx_web-1.13.8.tar.gz",
        bytes: 4351745,
        sha256: "e25a3813eb080636280b23dd4b0098252902675158b66dceda1efba061adf5d7"
      },
      license: {
        name: "Apache-2.0",
        source: "https://github.com/k2-fsa/sherpa-onnx/blob/11afbd009a7f8c08f4bcf2fc1b265d0df4670fbf/LICENSE",
        repositoryPath: "licenses/sherpa-onnx-LICENSE.txt",
        bytes: 11358,
        sha256: "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30"
      },
      provenance: {
        pubspec: "https://github.com/k2-fsa/sherpa-onnx/blob/11afbd009a7f8c08f4bcf2fc1b265d0df4670fbf/flutter/sherpa_onnx_web/pubspec.yaml",
        workflow: "https://github.com/k2-fsa/sherpa-onnx/blob/11afbd009a7f8c08f4bcf2fc1b265d0df4670fbf/.github/workflows/release-dart-package.yaml#L923",
        metadata: "https://pub.dev/api/packages/sherpa_onnx_web/versions/1.13.8",
        registryUploaderVerified: false,
        executedSourceGitShaVerified: false
      },
      initialMemoryBytes: 536870912,
      maximumMemoryBytes: 2147483648
    },
    model: {
      kind: "senseVoice",
      name: "SenseVoiceSmall INT8",
      author: "FunAudioLLM / Alibaba Group",
      revision: "2365baeacb507f821a0c8120fcee3d484dba7a07",
      source: "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/tree/2365baeacb507f821a0c8120fcee3d484dba7a07",
      modelCard: "https://huggingface.co/FunAudioLLM/SenseVoiceSmall",
      license: {
        name: "FunASR Model Open Source License Agreement 1.1",
        source: "https://github.com/modelscope/FunASR/blob/66d7a4c264a5993a2a63ed00c1f402c296ee521a/MODEL_LICENSE",
        repositoryPath: "licenses/SenseVoice-MODEL-LICENSE.txt",
        bytes: 5306,
        sha256: "7dba975a2069691db4992b0592d70828b330d2f8a30a71450f4e152a554e84f8"
      }
    },
    files: [
      {
        role: "glue",
        filename: "sherpa-onnx-wasm-web.js",
        bytes: 93039,
        sha256: "28f909145d93018c90c181035a008880ceaa94a72b66603dc7bb7c619714c23c",
        source: "https://pub.dev/api/archives/sherpa_onnx_web-1.13.8.tar.gz",
        archivePath: "assets/sherpa-onnx-wasm-web.js"
      },
      {
        role: "wasm",
        filename: "sherpa-onnx-wasm-web.wasm",
        bytes: 15133855,
        sha256: "e0d84744c39a28121f7738a161a21612788f4e8f07879a7224e74919e9831573",
        source: "https://pub.dev/api/archives/sherpa_onnx_web-1.13.8.tar.gz",
        archivePath: "assets/sherpa-onnx-wasm-web.wasm"
      },
      {
        role: "wrapper",
        filename: "sherpa-onnx-asr.js",
        bytes: 53867,
        sha256: "d51ae8e8b756ee5e53423ffada0c9702973f154f561aca7984fe0b12f4060178",
        source: "https://pub.dev/api/archives/sherpa_onnx_web-1.13.8.tar.gz",
        archivePath: "assets/sherpa-onnx-asr.js"
      },
      {
        role: "model",
        filename: "model.int8.onnx",
        bytes: 239233841,
        sha256: "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51",
        source: "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/model.int8.onnx"
      },
      {
        role: "tokens",
        filename: "tokens.txt",
        bytes: 315894,
        sha256: "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc",
        source: "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/tokens.txt"
      }
    ],
    limits: {
      recordingSeconds: 30,
      initializationMilliseconds: 12e4,
      permissionMilliseconds: 3e4,
      recognitionMilliseconds: 6e4
    }
  };

  // src/browser/voice/manifest.ts
  function freeze(value) {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  }
  var VOICE_RESOURCES = freeze(resources_default);
  var roles = ["glue", "wasm", "wrapper", "model", "tokens", "worker", "worklet"];
  var invalid = () => new Error("\u672C\u5730\u8BED\u97F3\u8D44\u6E90\u6E05\u5355\u7684\u7248\u672C\u3001\u6765\u6E90\u6216\u6821\u9A8C\u5143\u6570\u636E\u4E0D\u5339\u914D\u3002");
  var record = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
    return value;
  };
  var exactKeys = (value, keys) => {
    if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) throw invalid();
  };
  function validateVoiceManifest(value, baseUrl) {
    if (!baseUrl.startsWith("/")) {
      const absolute = new URL(baseUrl);
      if (!["https:", "http:"].includes(absolute.protocol) || absolute.username || absolute.password || absolute.search || absolute.hash) throw invalid();
      baseUrl = absolute.pathname;
    }
    const item = record(value);
    exactKeys(item, ["schemaVersion", "buildId", "basePath", "modelKind", "runtimeVersion", "files"]);
    if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(baseUrl) || typeof item.buildId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(item.buildId) || item.schemaVersion !== 1 || item.modelKind !== "senseVoice" || item.runtimeVersion !== resources_default.runtime.version || item.basePath !== `${baseUrl}${resources_default.pathPrefix}${resources_default.runtime.version}/${item.buildId}/` || !Array.isArray(item.files) || item.files.length !== roles.length) throw invalid();
    const files = item.files.map((value2, index) => {
      const file = record(value2);
      exactKeys(file, ["role", "filename", "url", "downloadUrl", "bytes", "sha256"]);
      const role = roles[index];
      const pinned = resources_default.files.find((file2) => file2.role === role);
      const filename = pinned?.filename ?? (role === "worker" ? "runtime.worker.js" : "capture.worklet.js");
      const url = item.basePath + filename;
      if (file.role !== role || file.filename !== filename || file.url !== url || typeof file.bytes !== "number" || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256) || pinned && (file.bytes !== pinned.bytes || file.sha256 !== pinned.sha256) || file.downloadUrl !== url + "?wb-asr-download=1" && (!(role === "model" || role === "tokens") || file.downloadUrl !== pinned?.source)) throw invalid();
      return { role, filename, url, downloadUrl: file.downloadUrl, bytes: file.bytes, sha256: file.sha256 };
    });
    return freeze({ schemaVersion: 1, buildId: item.buildId, basePath: item.basePath, modelKind: "senseVoice", runtimeVersion: "1.13.8", files });
  }

  // src/browser/voice/runtime.worker.ts
  var initializationStarted = false;
  var recognizer = null;
  var lastRequestId = -1;
  var error = (requestId, code) => postMessage({ type: "error", requestId, code });
  function workerBase() {
    const location = new URL(self.location.href);
    const match = location.pathname.match(/^(\/(?:[A-Za-z0-9_-]+\/)*)optional-asr\/1\.13\.8\/[A-Za-z0-9_-]+\/runtime\.worker\.js$/);
    if (!match || location.search || location.hash || !["http:", "https:"].includes(location.protocol)) throw Error("Invalid worker location");
    return location.origin + match[1];
  }
  function resourceUrl(manifest, role) {
    return new URL(manifest.files.find((file) => file.role === role).url, self.location.href).href;
  }
  async function initialize(requestId, data) {
    if (initializationStarted) {
      error(requestId, "initialization");
      return;
    }
    initializationStarted = true;
    lastRequestId = requestId - 1;
    try {
      const manifest = validateVoiceManifest(data.manifest, workerBase());
      if (resourceUrl(manifest, "worker") !== self.location.href) throw Error("Wrong build worker");
      const buffers = data.buffers;
      for (const role of ["model", "tokens"]) {
        if (!(buffers?.[role] instanceof ArrayBuffer) || buffers[role].byteLength !== manifest.files.find((file) => file.role === role).bytes) throw Error("Invalid model buffers");
      }
      postMessage({ type: "progress", requestId, stage: "runtime" });
      importScripts(resourceUrl(manifest, "glue"), resourceUrl(manifest, "wrapper"));
      const wasm = manifest.files.find((file) => file.role === "wasm");
      const engine = await SherpaOnnx({
        locateFile: (name) => {
          if (name !== wasm.filename) throw Error("Unexpected runtime resource");
          return resourceUrl(manifest, "wasm");
        },
        print: () => {
        },
        printErr: () => {
        }
      });
      postMessage({ type: "progress", requestId, stage: "model" });
      engine.FS.writeFile("/model.int8.onnx", new Uint8Array(buffers.model), { canOwn: true });
      engine.FS.writeFile("/tokens.txt", new Uint8Array(buffers.tokens), { canOwn: true });
      const next = new OfflineRecognizer({
        featConfig: { sampleRate: 16e3, featureDim: 80 },
        modelConfig: {
          tokens: "/tokens.txt",
          numThreads: 1,
          provider: "cpu",
          debug: 0,
          senseVoice: { model: "/model.int8.onnx", language: "", useInverseTextNormalization: 1 }
        },
        decodingMethod: "greedy_search"
      }, engine);
      if (!next.handle) throw Error("Recognizer unavailable");
      recognizer = next;
      postMessage({ type: "ready", requestId, heapBufferBytes: engine.HEAPU8.buffer.byteLength });
    } catch {
      recognizer = null;
      error(requestId, "initialization");
    }
  }
  function transcribe(requestId, data) {
    if (!recognizer || requestId <= lastRequestId) {
      error(requestId, "recognition");
      return;
    }
    lastRequestId = requestId;
    try {
      const rate = data.sampleRate, pcm = data.pcm;
      if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 8e3 || rate > 96e3 || !(pcm instanceof Float32Array) || !pcm.length || pcm.length > Math.floor(rate * 30)) throw Error("Invalid audio");
      let peak = 0;
      for (const value of pcm) {
        if (!Number.isFinite(value) || Math.abs(value) > 1) throw Error("Invalid audio");
        peak = Math.max(peak, Math.abs(value));
      }
      if (peak < 1e-7) throw Error("No speech");
      let stream;
      let text;
      try {
        stream = recognizer.createStream();
        stream.acceptWaveform(rate, pcm);
        recognizer.decode(stream);
        text = recognizer.getResult(stream).text;
        if (typeof text !== "string" || !text.trim() || text.length > 2e4) throw Error("No text");
      } finally {
        stream?.free();
      }
      postMessage({ type: "result", requestId, text });
    } catch {
      error(requestId, "recognition");
    }
  }
  self.onmessage = async (event) => {
    if (!event.data || typeof event.data !== "object") return;
    const data = event.data, requestId = data.requestId;
    if (typeof requestId !== "number" || !Number.isSafeInteger(requestId) || requestId < 0) return;
    if (data.type === "init") await initialize(requestId, data);
    else if (data.type === "transcribe") transcribe(requestId, data);
  };
})();
