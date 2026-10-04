import { describe, expect, it } from 'vitest';
import { defaultVoiceSettings, encodeWav, validateWav, speechChunks, parseTranscript } from '../src/core/speech';
import { emptyState, validateState } from '../src/core/state';

describe('local speech boundary', () => {
  it('encodes signed mono PCM and validates the sample rate and length', () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1]));
    expect(validateWav(wav)).toBe(5 / 16000);
    const view = new DataView(wav);
    expect(view.getInt16(46, true)).toBe(16383);
    expect(view.getInt16(48, true)).toBe(-16384);
    expect(view.getInt16(52, true)).toBe(-32768);
  });
  it('rejects malformed and overly long audio before writing temporary files', () => {
    expect(() => validateWav(new ArrayBuffer(0))).toThrow('录音');
    const wrongRate = encodeWav(new Float32Array([1]));
    new DataView(wrongRate).setUint32(24, 48000, true);
    expect(() => validateWav(wrongRate)).toThrow('16000');
    expect(() => validateWav(encodeWav(new Float32Array(16000 * 61)))).toThrow('60 秒');
  });
  it('extracts only the recognized words from CLI output and rejects no-speech', () => {
    expect(parseTranscript('Started\n{"text":"<|zh|><|NEUTRAL|><|Speech|>你好，HTTP。<|withitn|>"}\nDone')).toBe('你好，HTTP。');
    expect(() => parseTranscript('{"text":"<|nospeech|>"}')).toThrow('没有识别到');
    expect(() => parseTranscript('could not load model')).toThrow('识别结果');
  });
});

describe('read aloud and saved state', () => {
  it('skips fenced code, reads link labels, and splits long Chinese text without dropping characters', () => {
    expect(speechChunks('## 你好\n```js\nsecretCode()\n```\n看[说明](https://example.com)')).toEqual(['你好\n代码段已略过。\n看说明']);
    const text = '这是一段长句。'.repeat(90);
    const chunks = speechChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(chunk => chunk.length <= 240)).toBe(true);
    expect(chunks.join('')).toBe(text);
  });
  it('migrates old backups with automatic playback off', () => {
    const old = emptyState(); delete (old.settings as any).voice;
    expect(validateState(old).settings.voice).toEqual(defaultVoiceSettings());
  });
  it('does not enable automatic speech from malformed imported settings', () => {
    const state = emptyState();
    (state.settings as any).voice = { autoRead: 'true', rate: 900, voice: null };
    expect(validateState(state).settings.voice).toEqual(defaultVoiceSettings());
  });
});
