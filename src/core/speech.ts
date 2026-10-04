export interface VoiceSettings { autoRead: boolean; rate: number; voice: string }
export const defaultVoiceSettings = (): VoiceSettings => ({ autoRead: false, rate: 1, voice: '' });
export const SAMPLE_RATE = 16000;
export const MAX_SECONDS = 60;

export function encodeWav(samples: Float32Array): ArrayBuffer {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const tag = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  tag(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); tag(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, index) => { const sample = Math.max(-1, Math.min(1, value)); view.setInt16(44 + index * 2, sample < 0 ? sample * 32768 : sample * 32767, true); });
  return bytes;
}

export function validateWav(bytes: ArrayBuffer): number {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 46) throw new Error('录音为空或格式不正确');
  const view = new DataView(bytes);
  const tag = (offset: number, size: number) => String.fromCharCode(...new Uint8Array(bytes, offset, size));
  if (tag(0, 4) !== 'RIFF' || tag(8, 4) !== 'WAVE' || tag(12, 4) !== 'fmt ' || tag(36, 4) !== 'data' || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 || view.getUint16(34, true) !== 16 || view.getUint32(24, true) !== SAMPLE_RATE) throw new Error('录音必须是 16000 Hz 单声道 PCM WAV');
  if (view.getUint32(40, true) !== bytes.byteLength - 44 || (bytes.byteLength - 44) % 2) throw new Error('录音数据不完整');
  const duration = (bytes.byteLength - 44) / 2 / SAMPLE_RATE;
  if (duration > MAX_SECONDS) throw new Error('每次语音输入最多 60 秒');
  return duration;
}

export function parseTranscript(output: string): string {
  for (const line of output.split('\n')) {
    try {
      const value = JSON.parse(line.trim());
      if (typeof value.text === 'string') {
        const text = value.text.replace(/<\|[^|]*\|>/g, '').trim();
        if (!text) throw new Error('没有识别到语音，请靠近麦克风重试');
        return text;
      }
    } catch (error) { if (error instanceof Error && error.message.startsWith('没有识别到')) throw error; }
  }
  throw new Error('未获得识别结果，请重试');
}

export function speechChunks(markdown: string): string[] {
  const text = markdown.replace(/```[\s\S]*?```/g, '代码段已略过。').replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^\s{0,3}#{1,6}\s+/gm, '').replace(/[*_`]/g, '').trim();
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > 240) {
    const part = rest.slice(0, 240);
    const boundary = Math.max(part.lastIndexOf('。'), part.lastIndexOf('！'), part.lastIndexOf('？'), part.lastIndexOf('\n'), part.lastIndexOf('. '));
    const end = boundary > 40 ? boundary + 1 : 240;
    chunks.push(rest.slice(0, end)); rest = rest.slice(end);
  }
  if (rest) chunks.push(rest);
  return chunks;
}
