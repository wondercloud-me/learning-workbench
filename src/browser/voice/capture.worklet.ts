// An external AudioWorklet script. No microphone audio is connected to speakers.
declare const sampleRate: number;
declare class AudioWorkletProcessor {readonly port: MessagePort;}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class VoiceCaptureProcessor extends AudioWorkletProcessor {
  private readonly captureId: number;
  private readonly limit = Math.floor(sampleRate * 30);
  private buffer: Float32Array | null = new Float32Array(2048);
  private used = 0;
  private received = 0;
  private emitted = 0;
  private accepting = true;
  private ended = false;

  constructor(options: {processorOptions?: {captureId?: number}} = {}) {
    super();
    this.captureId = options.processorOptions?.captureId as number;
    this.port.onmessage = event => {
      if (event.data?.captureId !== this.captureId || this.ended) return;
      if (event.data.type === 'cancel') {
        this.discard();
      } else if (event.data.type === 'flush') {
        this.accepting = false;
        this.flush();
        this.ended = true;
        this.buffer = null;
        this.port.postMessage({type: 'flushed', captureId: this.captureId, sampleRate, totalSamples: this.emitted});
      }
    };
    if (!Number.isSafeInteger(this.captureId) || this.captureId < 0
      || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 96000) this.fail('invalid-config');
  }

  private discard() {
    this.accepting = false;
    this.ended = true;
    this.buffer = null;
    this.used = 0;
  }
  private fail(code: 'invalid-pcm' | 'invalid-config') {
    this.discard();
    this.port.postMessage({type: 'error', captureId: this.captureId, code});
  }
  private flush() {
    if (!this.buffer || !this.used) return;
    const pcm = this.used === this.buffer.length ? this.buffer : this.buffer.slice(0, this.used);
    this.emitted += this.used;
    this.buffer = new Float32Array(2048);
    this.used = 0;
    this.port.postMessage({type: 'pcm', captureId: this.captureId, sampleRate, totalSamples: this.emitted, pcm}, [pcm.buffer]);
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    if (!this.accepting || this.ended) return true;
    const channels = inputs[0] ?? [];
    if (!channels.length || !channels[0].length) return true;
    const count = channels[0].length;
    for (const channel of channels) {
      if (channel.length !== count) {this.fail('invalid-pcm'); return true;}
      for (let index = 0; index < count; index++) {
        if (!Number.isFinite(channel[index]) || Math.abs(channel[index]) > 1) {this.fail('invalid-pcm'); return true;}
      }
    }
    const accepted = Math.min(count, this.limit - this.received);
    for (let index = 0; index < accepted; index++) {
      let mono = 0;
      for (const channel of channels) mono += channel[index] / channels.length;
      this.buffer![this.used++] = mono;
      this.received++;
      if (this.used === 2048) this.flush();
    }
    if (this.received === this.limit) {
      this.accepting = false;
      this.port.postMessage({type: 'limit', captureId: this.captureId, totalSamples: this.received});
    }
    // Keep the port alive for the final flush even after the sample limit.
    return true;
  }
}

registerProcessor('workbench-voice-capture', VoiceCaptureProcessor);
export {};
