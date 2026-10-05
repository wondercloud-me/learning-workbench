"use strict";
(() => {
  // src/browser/voice/capture.worklet.ts
  var VoiceCaptureProcessor = class extends AudioWorkletProcessor {
    captureId;
    limit = Math.floor(sampleRate * 30);
    buffer = new Float32Array(2048);
    used = 0;
    received = 0;
    emitted = 0;
    accepting = true;
    ended = false;
    constructor(options = {}) {
      super();
      this.captureId = options.processorOptions?.captureId;
      this.port.onmessage = (event) => {
        if (event.data?.captureId !== this.captureId || this.ended) return;
        if (event.data.type === "cancel") {
          this.discard();
        } else if (event.data.type === "flush") {
          this.accepting = false;
          this.flush();
          this.ended = true;
          this.buffer = null;
          this.port.postMessage({ type: "flushed", captureId: this.captureId, sampleRate, totalSamples: this.emitted });
        }
      };
      if (!Number.isSafeInteger(this.captureId) || this.captureId < 0 || !Number.isFinite(sampleRate) || sampleRate < 8e3 || sampleRate > 96e3) this.fail("invalid-config");
    }
    discard() {
      this.accepting = false;
      this.ended = true;
      this.buffer = null;
      this.used = 0;
    }
    fail(code) {
      this.discard();
      this.port.postMessage({ type: "error", captureId: this.captureId, code });
    }
    flush() {
      if (!this.buffer || !this.used) return;
      const pcm = this.used === this.buffer.length ? this.buffer : this.buffer.slice(0, this.used);
      this.emitted += this.used;
      this.buffer = new Float32Array(2048);
      this.used = 0;
      this.port.postMessage({ type: "pcm", captureId: this.captureId, sampleRate, totalSamples: this.emitted, pcm }, [pcm.buffer]);
    }
    process(inputs, outputs) {
      for (const output of outputs) for (const channel of output) channel.fill(0);
      if (!this.accepting || this.ended) return true;
      const channels = inputs[0] ?? [];
      if (!channels.length || !channels[0].length) return true;
      const count = channels[0].length;
      for (const channel of channels) {
        if (channel.length !== count) {
          this.fail("invalid-pcm");
          return true;
        }
        for (let index = 0; index < count; index++) {
          if (!Number.isFinite(channel[index]) || Math.abs(channel[index]) > 1) {
            this.fail("invalid-pcm");
            return true;
          }
        }
      }
      const accepted = Math.min(count, this.limit - this.received);
      for (let index = 0; index < accepted; index++) {
        let mono = 0;
        for (const channel of channels) mono += channel[index] / channels.length;
        this.buffer[this.used++] = mono;
        this.received++;
        if (this.used === 2048) this.flush();
      }
      if (this.received === this.limit) {
        this.accepting = false;
        this.port.postMessage({ type: "limit", captureId: this.captureId, totalSamples: this.received });
      }
      return true;
    }
  };
  registerProcessor("workbench-voice-capture", VoiceCaptureProcessor);
})();
