// PCM16 ↔ WAV helpers (used for the per-turn HTTP transcription fallback).

export function pcm16ToWav(frames: Int16Array[], sampleRate: number): Blob {
  const total = frames.reduce((n, f) => n + f.length, 0);
  const buffer = new ArrayBuffer(44 + total * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + total * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, total * 2, true);
  let off = 44;
  for (const f of frames) {
    new Int16Array(buffer, off, f.length).set(f);
    off += f.length * 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export function concatPcm16(frames: Int16Array[]): Int16Array {
  const total = frames.reduce((n, f) => n + f.length, 0);
  const out = new Int16Array(total);
  let off = 0;
  for (const f of frames) {
    out.set(f, off);
    off += f.length;
  }
  return out;
}

/** Base64 for the Realtime `input_audio_buffer.append` event. */
export function pcm16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + step)));
  }
  return btoa(binary);
}
