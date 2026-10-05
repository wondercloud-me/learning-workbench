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
function voiceManifestJson(manifest2) {
  return JSON.stringify({
    schemaVersion: manifest2.schemaVersion,
    buildId: manifest2.buildId,
    basePath: manifest2.basePath,
    modelKind: manifest2.modelKind,
    runtimeVersion: manifest2.runtimeVersion,
    files: manifest2.files.map((file) => ({ role: file.role, filename: file.filename, url: file.url, downloadUrl: file.downloadUrl, bytes: file.bytes, sha256: file.sha256 }))
  });
}

// src/browser/voice/model-store.ts
var VoiceStoreError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "VoiceStoreError";
  }
  code;
};
var error = (code, message) => new VoiceStoreError(code, message);
var cancelled = () => error("cancelled", "\u4E0B\u8F7D\u6216\u7F13\u5B58\u8BFB\u53D6\u5DF2\u53D6\u6D88\u3002");
var storageError = (cause) => cause instanceof VoiceStoreError ? cause : cause instanceof DOMException && cause.name === "QuotaExceededError" ? error("quota", "\u7A7A\u95F4\u4E0D\u8DB3\uFF0C\u8BF7\u5220\u9664\u53EF\u9009\u4E0B\u8F7D\u540E\u91CD\u8BD5\u3002") : error("storage", "\u53EF\u9009\u8BED\u97F3\u7F13\u5B58\u4E0D\u53EF\u7528\uFF0C\u8BF7\u7EE7\u7EED\u952E\u76D8\u8F93\u5165\u6216\u5220\u9664\u540E\u91CD\u65B0\u4E0B\u8F7D\u3002");
var contentTypes = {
  glue: "application/javascript",
  wasm: "application/wasm",
  wrapper: "application/javascript",
  model: "application/octet-stream",
  tokens: "text/plain; charset=utf-8",
  worker: "application/javascript",
  worklet: "application/javascript"
};
function createVoiceModelStore(input, ports) {
  const manifest2 = JSON.parse(voiceManifestJson(input));
  const namespace = VOICE_RESOURCES.namespace + ":";
  const origin = new URL(ports.origin).origin;
  const urls = manifest2.files.map((file) => new URL(file.url, origin).href);
  const markerUrl = new URL(manifest2.basePath + "ready.json", origin).href;
  const totalBytes = manifest2.files.reduce((sum, file) => sum + file.bytes, 0);
  let generation = 0;
  let deletionGeneration = 0;
  let ready2 = false;
  let deleting = Promise.resolve();
  let active;
  const current = (observed) => {
    if (observed !== generation) throw cancelled();
  };
  const digest = async (buffer) => {
    if (!ports.crypto?.subtle) throw error("unsupported", "\u6D4F\u89C8\u5668\u7F3A\u5C11 WebCrypto\uFF0C\u4E0D\u80FD\u9A8C\u8BC1\u672C\u5730\u6A21\u578B\u3002");
    const result = await ports.crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  const identity = () => digest(new TextEncoder().encode(voiceManifestJson(manifest2)).buffer);
  const detach = async (attempt) => {
    if (!attempt?.name) return;
    try {
      await attempt.cache;
    } catch {
    }
    await ports.caches.delete(attempt.name);
  };
  const verify = async (response, file, observed) => {
    current(observed);
    if (!response) throw error("missing", "\u53EF\u9009\u8D44\u6E90\u7F3A\u5931\uFF1B\u79BB\u7EBF\u65F6\u8BF7\u7EE7\u7EED\u952E\u76D8\u8F93\u5165\uFF0C\u8054\u7F51\u540E\u91CD\u65B0\u4E0B\u8F7D\u3002");
    if (response.type === "opaque" || response.type === "opaqueredirect") throw error("opaque", "\u6A21\u578B\u54CD\u5E94\u4E0D\u53EF\u8BFB\uFF0C\u65E0\u6CD5\u8FDB\u884C\u672C\u5730\u6821\u9A8C\u3002");
    const buffer = await response.arrayBuffer();
    current(observed);
    if (buffer.byteLength !== file.bytes || await digest(buffer) !== file.sha256) throw error("integrity", "\u6A21\u578B\u8D44\u6E90\u5927\u5C0F\u6216 SHA-256 \u4E0D\u5339\u914D\uFF0C\u8BF7\u5220\u9664\u540E\u91CD\u65B0\u4E0B\u8F7D\u3002");
    current(observed);
    return buffer;
  };
  const cancel = () => {
    generation++;
    const previous = active;
    active = void 0;
    previous?.abort.abort();
    return detach(previous).catch((cause) => {
      throw storageError(cause);
    });
  };
  return {
    status: () => active ? "downloading" : ready2 ? "ready" : "missing",
    cancel,
    delete: () => {
      deletionGeneration++;
      ready2 = false;
      const stopping = cancel();
      deleting = deleting.catch(() => {
      }).then(async () => {
        await stopping;
        const names = await ports.caches.keys();
        await Promise.all(names.filter((name) => name.startsWith(namespace)).map((name) => ports.caches.delete(name)));
      }).catch((cause) => {
        throw storageError(cause);
      });
      return deleting;
    },
    download: async (progress2) => {
      if (active) throw error("busy", "\u5DF2\u7ECF\u6709\u4E00\u4E2A\u6A21\u578B\u4E0B\u8F7D\u6B63\u5728\u8FDB\u884C\u3002");
      if (!ports.caches || !ports.fetch || !ports.crypto?.subtle) throw error("unsupported", "\u6D4F\u89C8\u5668\u7F3A\u5C11\u6A21\u578B\u7F13\u5B58\u6216\u6821\u9A8C\u80FD\u529B\u3002");
      const attempt = { generation: ++generation, abort: new AbortController(), committed: false };
      active = attempt;
      const check = () => {
        current(attempt.generation);
        if (active !== attempt || attempt.abort.signal.aborted) throw cancelled();
      };
      let receivedBytes = 0;
      try {
        await deleting;
        check();
        const manifestDigest = await identity();
        check();
        const id = ports.generationId();
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw error("storage", "\u7F13\u5B58\u4EE3\u6B21\u7F16\u53F7\u65E0\u6548\u3002");
        attempt.name = `${namespace}${manifestDigest}:${id}-${attempt.generation}`;
        attempt.cache = ports.caches.open(attempt.name);
        const cache = await attempt.cache;
        check();
        for (let index = 0; index < manifest2.files.length; index++) {
          const file = manifest2.files[index];
          check();
          let response;
          try {
            response = await ports.fetch(new URL(file.downloadUrl, origin).href, { signal: attempt.abort.signal, credentials: "omit", cache: "no-store", mode: "cors" });
          } catch (cause) {
            check();
            throw error("network", "\u8D44\u6E90\u4E0B\u8F7D\u5931\u8D25\uFF1B\u8BF7\u68C0\u67E5\u7F51\u7EDC\u548C CORS \u540E\u91CD\u8BD5\u3002");
          }
          check();
          if (response.type === "opaque" || response.type === "opaqueredirect") throw error("opaque", "\u4E0B\u8F7D\u54CD\u5E94\u4E0D\u53EF\u8BFB\uFF0C\u65E0\u6CD5\u6821\u9A8C\u3002");
          if (!response.ok) throw error("http", `\u8D44\u6E90\u4E0B\u8F7D\u5931\u8D25\uFF08HTTP ${response.status}\uFF09\u3002`);
          if (!response.body) throw error("integrity", "\u4E0B\u8F7D\u54CD\u5E94\u6CA1\u6709\u53EF\u8BFB\u53D6\u7684\u5B57\u8282\u3002");
          const reader = response.body.getReader();
          let fileReceivedBytes = 0;
          const abortReader = () => {
            void reader.cancel().catch(() => {
            });
          };
          attempt.abort.signal.addEventListener("abort", abortReader, { once: true });
          const body = new ReadableStream({
            async pull(controller) {
              try {
                check();
                const chunk = await reader.read();
                check();
                if (chunk.done) {
                  if (fileReceivedBytes !== file.bytes) throw error("integrity", "\u4E0B\u8F7D\u5B57\u8282\u6570\u4E0D\u8DB3\uFF0C\u672A\u4FDD\u5B58\u5C31\u7EEA\u6A21\u578B\u3002");
                  controller.close();
                  return;
                }
                fileReceivedBytes += chunk.value.byteLength;
                receivedBytes += chunk.value.byteLength;
                if (fileReceivedBytes > file.bytes) throw error("integrity", "\u4E0B\u8F7D\u5B57\u8282\u6570\u8D85\u8FC7\u6E05\u5355\u5927\u5C0F\uFF0C\u5DF2\u505C\u6B62\u4E0B\u8F7D\u3002");
                progress2?.({ receivedBytes, totalBytes, currentFile: file.filename, fileReceivedBytes, fileTotalBytes: file.bytes });
                check();
                controller.enqueue(chunk.value);
              } catch (cause) {
                controller.error(cause);
                void reader.cancel().catch(() => {
                });
              }
            },
            cancel: () => reader.cancel()
          });
          try {
            await cache.put(urls[index], new Response(body, { headers: { "content-type": contentTypes[file.role] } }));
            check();
            await verify(await cache.match(urls[index]), file, attempt.generation);
            check();
          } finally {
            attempt.abort.signal.removeEventListener("abort", abortReader);
            void reader.cancel().catch(() => {
            });
            reader.releaseLock();
          }
        }
        const marker = { schemaVersion: 1, manifestDigest, cacheName: attempt.name, resourceUrls: urls };
        check();
        await cache.put(markerUrl, new Response(JSON.stringify(marker), { headers: { "content-type": "application/json" } }));
        check();
        attempt.committed = true;
        ready2 = true;
      } catch (cause) {
        if (attempt.generation !== generation || attempt.abort.signal.aborted) throw cancelled();
        throw storageError(cause);
      } finally {
        if (!attempt.committed) {
          attempt.abort.abort();
          await detach(attempt).catch(() => {
          });
        }
        if (active === attempt) active = void 0;
      }
    },
    load: async () => {
      const observed = generation;
      const deleted = deletionGeneration;
      let opened;
      try {
        await deleting;
        current(observed);
        const manifestDigest = await identity();
        current(observed);
        const prefix2 = namespace + manifestDigest + ":";
        const names = (await ports.caches.keys()).filter((name) => name.startsWith(prefix2)).reverse();
        current(observed);
        for (const name of names) {
          opened = name;
          const cache = await ports.caches.open(name);
          current(observed);
          const response = await cache.match(markerUrl);
          current(observed);
          if (!response) continue;
          let marker;
          try {
            marker = await response.json();
          } catch {
            throw error("integrity", "\u6A21\u578B\u5C31\u7EEA\u8BB0\u5F55\u635F\u574F\uFF0C\u8BF7\u5220\u9664\u540E\u91CD\u65B0\u4E0B\u8F7D\u3002");
          }
          current(observed);
          if (!marker || typeof marker !== "object" || JSON.stringify(marker) !== JSON.stringify({ schemaVersion: 1, manifestDigest, cacheName: name, resourceUrls: urls })) throw error("integrity", "\u6A21\u578B\u7248\u672C\u6216\u5C31\u7EEA\u8BB0\u5F55\u4E0D\u5339\u914D\u3002");
          const buffers = {};
          for (let index = 0; index < manifest2.files.length; index++) {
            buffers[manifest2.files[index].role] = await verify(await cache.match(urls[index]), manifest2.files[index], observed);
          }
          current(observed);
          ready2 = true;
          return buffers;
        }
        throw error("missing", "\u6CA1\u6709\u5B8C\u6574\u7684\u6A21\u578B\u4E0B\u8F7D\uFF1B\u79BB\u7EBF\u65F6\u8BF7\u7EE7\u7EED\u952E\u76D8\u8F93\u5165\u3002");
      } catch (cause) {
        if (deleted !== deletionGeneration && opened) await ports.caches.delete(opened).catch(() => {
        });
        if (observed !== generation) throw cancelled();
        ready2 = false;
        throw storageError(cause);
      }
    }
  };
}

// .cache/browser-voice-hf-host-gate-20261005/settings.json
var settings_default = {
  origin: "https://wondercloud-me.github.io",
  experiment: "browser-voice-hf-host-gate-20261005",
  basePath: "/learning-workbench/voice-host-probe/",
  buildId: "hf-host-gate-20261005",
  manifestDigest: "7caef864672909b0927a0a9dbb9d6216bb0248862e33ebead99bc2e6c11b9348"
};

// .cache/browser-voice-hf-host-gate-20261005/harness.ts
var node = (id) => document.getElementById(id);
var events = [];
var requests = [];
var cspViolations = [];
var manifest;
var store;
var busy = false;
var attempted = false;
var progress;
var ready;
var loaded;
var started = performance.now();
var expectedOrigin = settings_default.origin;
var base = settings_default.basePath;
var prefix = VOICE_RESOURCES.namespace + ":" + settings_default.manifestDigest + ":";
var environment = {
  origin: location.origin,
  pathname: location.pathname,
  secureContext: isSecureContext,
  crossOriginIsolated,
  userAgent: navigator.userAgent,
  serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller)
};
var validLocation = location.origin === expectedOrigin && location.pathname === base;
function record2(stage, detail = {}) {
  events.push({ stage, elapsedMs: performance.now() - started, ...detail });
  render();
}
function safeError(cause) {
  return { name: cause instanceof Error ? cause.name : "Error", code: typeof cause === "object" && cause !== null && "code" in cause ? String(cause.code) : "unknown" };
}
function render() {
  node("check").disabled = busy || Boolean(manifest) || !validLocation;
  node("download").disabled = busy || !store || attempted || !node("consent").checked;
  node("load").disabled = busy || !store || !ready || Boolean(loaded);
  node("delete").disabled = busy || !manifest;
  node("state").textContent = JSON.stringify({
    experiment: settings_default.experiment,
    environment,
    validLocation,
    manifestDigest: settings_default.manifestDigest,
    totalBytes: manifest?.files.reduce((n, f) => n + f.bytes, 0),
    storeStatus: store?.status(),
    attempted,
    busy,
    progress,
    ready,
    loaded,
    lastEvent: events.at(-1)
  }, null, 2);
  node("progress").textContent = progress ? `${progress.currentFile}: ${progress.fileReceivedBytes} / ${progress.fileTotalBytes} B\uFF1B\u603B\u8BA1 ${progress.receivedBytes} / ${progress.totalBytes} B` : "\u5C1A\u672A\u4E0B\u8F7D";
}
var hex = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
function checkedName(name) {
  if (!name.startsWith(prefix)) throw new Error("\u7F13\u5B58\u540D\u79F0\u8D85\u51FA\u672C\u63A2\u9488 digest");
  return name;
}
var scopedCaches = {
  open: (name) => caches.open(checkedName(name)),
  keys: async () => (await caches.keys()).filter((name) => name.startsWith(prefix)),
  delete: (name) => caches.delete(checkedName(name))
};
document.addEventListener("securitypolicyviolation", (event) => {
  let blockedHost = event.blockedURI;
  try {
    blockedHost = new URL(event.blockedURI).hostname;
  } catch {
    blockedHost = ["inline", "eval"].includes(blockedHost) ? blockedHost : "unavailable";
  }
  cspViolations.push({ directive: event.effectiveDirective, blockedHost, elapsedMs: performance.now() - started });
  render();
});
node("consent").addEventListener("change", render);
node("check").addEventListener("click", async () => {
  if (busy || manifest || !validLocation) return;
  busy = true;
  record2("manifest-check-start");
  try {
    const response = await fetch(base + "resources.json", { mode: "same-origin", credentials: "omit", cache: "no-store" });
    if (!response.ok) throw new Error("\u6E05\u5355\u8BF7\u6C42\u5931\u8D25");
    const checked = validateVoiceManifest(await response.json(), base);
    const digest = await hex(new TextEncoder().encode(voiceManifestJson(checked)).buffer);
    if (digest !== settings_default.manifestDigest || checked.buildId !== settings_default.buildId) throw new Error("\u6E05\u5355\u8EAB\u4EFD\u4E0D\u7B26");
    manifest = checked;
    store = createVoiceModelStore(checked, {
      caches: scopedCaches,
      crypto,
      origin: location.origin,
      generationId: () => crypto.randomUUID(),
      fetch: async (input, init) => {
        const file = checked.files.find((f) => new URL(f.downloadUrl, location.origin).href === input);
        if (!file) throw new Error("\u4E0D\u5141\u8BB8\u7684\u8D44\u6E90 URL");
        const entry = {
          role: file.role,
          fixedUrl: input,
          expectedBytes: file.bytes,
          expectedSha256: file.sha256,
          actualBytes: 0,
          startedMs: performance.now() - started
        };
        requests.push(entry);
        try {
          const response2 = await fetch(input, init);
          entry.status = response2.status;
          entry.type = response2.type;
          entry.finalHostname = new URL(response2.url).hostname;
          entry.redirected = response2.redirected;
          entry.headersReceivedMs = performance.now() - started;
          return response2;
        } catch (cause) {
          entry.error = safeError(cause);
          throw cause;
        }
      }
    });
    record2("manifest-validated", { digest, totalBytes: checked.files.reduce((n, f) => n + f.bytes, 0) });
  } catch (cause) {
    record2("manifest-check-error", safeError(cause));
  } finally {
    busy = false;
    render();
  }
});
node("download").addEventListener("click", async () => {
  if (busy || !store || attempted || !node("consent").checked) return;
  busy = true;
  attempted = true;
  record2("download-start");
  try {
    await store.download((value) => {
      progress = value;
      const entry = requests.find((r) => r.role === manifest?.files.find((f) => f.filename === value.currentFile)?.role);
      if (entry) entry.actualBytes = value.fileReceivedBytes;
      render();
    });
    const names = await scopedCaches.keys();
    const markerUrl = new URL(manifest.basePath + "ready.json", location.origin).href;
    for (const name of names.slice().reverse()) {
      const response = await (await scopedCaches.open(name)).match(markerUrl);
      if (!response) continue;
      const marker = await response.json();
      const expected = {
        schemaVersion: 1,
        manifestDigest: settings_default.manifestDigest,
        cacheName: name,
        resourceUrls: manifest.files.map((f) => new URL(f.url, location.origin).href)
      };
      if (JSON.stringify(marker) !== JSON.stringify(expected)) throw new Error("ready marker \u4E0D\u5339\u914D");
      ready = expected;
      break;
    }
    if (!ready) throw new Error("\u7F3A\u5C11 ready marker");
    requests.forEach((r) => {
      r.verifiedByProductionDownload = true;
    });
    record2("download-ready", { resourceCount: manifest.files.length });
  } catch (cause) {
    record2("download-error", safeError(cause));
  } finally {
    busy = false;
    render();
  }
});
node("load").addEventListener("click", async () => {
  if (busy || !store || !manifest || !ready || loaded) return;
  busy = true;
  record2("load-start");
  try {
    const buffers = await store.load();
    const results = [];
    for (const file of manifest.files) {
      const buffer = buffers[file.role];
      const sha256 = await hex(buffer);
      if (buffer.byteLength !== file.bytes || sha256 !== file.sha256) throw new Error("load \u7ED3\u679C\u4E0D\u7B26");
      results.push({ role: file.role, bytes: buffer.byteLength, sha256 });
    }
    loaded = results;
    record2("load-verified", { resourceCount: results.length });
  } catch (cause) {
    record2("load-error", safeError(cause));
  } finally {
    busy = false;
    render();
  }
});
node("delete").addEventListener("click", async () => {
  if (busy || !store) return;
  busy = true;
  record2("delete-start");
  try {
    await store.delete();
    ready = void 0;
    loaded = void 0;
    record2("experiment-cache-deleted");
  } catch (cause) {
    record2("delete-error", safeError(cause));
  } finally {
    busy = false;
    render();
  }
});
function save(bytes, filename) {
  const url = URL.createObjectURL(bytes);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3e4);
}
node("export").addEventListener("click", () => {
  record2("evidence-export");
  const evidence = {
    schemaVersion: 1,
    experiment: settings_default.experiment,
    buildId: settings_default.buildId,
    manifestDigest: settings_default.manifestDigest,
    environment,
    manifest,
    events,
    requests,
    cspViolations,
    progress,
    ready,
    loaded,
    boundaries: {
      noInference: true,
      noWorkerExecution: true,
      noAudioContext: true,
      noMicrophone: true,
      noServiceWorkerRegistration: true,
      actualOriginRequired: expectedOrigin,
      publicOriginMatches: validLocation,
      networkSwitchObserved: false
    }
  };
  save(new Blob([JSON.stringify(evidence, null, 2) + "\n"], { type: "application/json" }), "hf-host-gate-evidence.json");
});
node("screenshot-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const raw = node("screenshot").value.trim();
    if (raw.length > 14e5) throw new Error("\u622A\u56FE\u8D85\u8FC7 1 MiB");
    const encoded = raw.replace(/^data:image\/(?:png|jpeg);base64,/, "").replace(/\s/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error("Base64 \u65E0\u6548");
    const decoded = atob(encoded);
    const bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
    if (bytes.length > 1048576) throw new Error("\u622A\u56FE\u8D85\u8FC7 1 MiB");
    const png = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b);
    const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!png && !jpeg) throw new Error("\u4EC5\u652F\u6301 PNG/JPEG");
    save(new Blob([bytes], { type: png ? "image/png" : "image/jpeg" }), "hf-host-gate-screenshot." + (png ? "png" : "jpg"));
    node("screenshot-status").textContent = "\u5DF2\u8BF7\u6C42\u6D4F\u89C8\u5668\u4E0B\u8F7D\u622A\u56FE\uFF1B\u5B9E\u9645\u672C\u5730\u8DEF\u5F84\u8BF7\u7531\u6D4F\u89C8\u5668\u4E0B\u8F7D\u5DE5\u5177\u8BB0\u5F55\u3002";
    node("screenshot").value = "";
  } catch (cause) {
    node("screenshot-status").textContent = cause instanceof Error ? cause.message : "\u622A\u56FE\u5BFC\u51FA\u5931\u8D25";
  }
});
render();
