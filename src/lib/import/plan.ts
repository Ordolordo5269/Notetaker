// Pure planning helpers for importing an audio file: where to cut it into
// chunks and which container to write. No browser or ffmpeg dependency, so
// they are unit-tested directly.

/** Smoothed loudness per fixed-length frame, from the start of the file. */
export interface QuietProfile {
  frameMs: number;
  /** One value per frame, larger = louder. Any scale. */
  energy: ArrayLike<number>;
}

export interface PlannedSegment {
  start: number;
  end: number;
}

export interface PlanOptions {
  /** Preferred chunk length in seconds. */
  target?: number;
  /** Never cut before this many seconds into a chunk… */
  min?: number;
  /** …nor after this many (then cut at `target`, even mid-sentence). */
  max?: number;
  /** A trailing remainder shorter than this is merged into the previous chunk. */
  mergeTail?: number;
}

/**
 * Loudness profile of mono PCM16 audio: RMS per `frameMs` frame, then a centred
 * moving average over `smoothMs` so a single quiet frame between two syllables
 * does not look like a pause. Relative values only; the noise floor of a noisy
 * classroom simply becomes the quietest level.
 */
export function energyProfile(
  samples: ArrayLike<number>,
  sampleRate: number,
  frameMs = 20,
  smoothMs = 300,
): QuietProfile {
  const frameLen = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const frames = Math.floor(samples.length / frameLen);
  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let acc = 0;
    const base = f * frameLen;
    for (let i = 0; i < frameLen; i++) {
      const v = samples[base + i]! / 32768;
      acc += v * v;
    }
    rms[f] = Math.sqrt(acc / frameLen);
  }
  const half = Math.max(0, Math.round(smoothMs / frameMs / 2));
  const energy = new Float32Array(frames);
  let window = 0;
  // Sliding window sum over [f - half, f + half].
  for (let f = 0; f < Math.min(frames, half + 1); f++) window += rms[f]!;
  for (let f = 0; f < frames; f++) {
    const lo = f - half;
    const hi = f + half;
    if (f > 0) {
      if (hi < frames) window += rms[hi]!;
      if (lo - 1 >= 0) window -= rms[lo - 1]!;
    }
    const count = Math.min(frames - 1, hi) - Math.max(0, lo) + 1;
    energy[f] = window / count;
  }
  return { frameMs, energy };
}

/**
 * Chunk boundaries for a file of `duration` seconds. Each chunk ends at the
 * quietest moment found between `min` and `max` seconds after it starts (a mild
 * pull towards `target` breaks ties); without a profile it ends at `target`.
 * Chunks never overlap, so the transcript has no duplicated text, and they
 * stay short enough for the file transcription model and for seeking.
 */
export function planSegments(
  duration: number,
  profile: QuietProfile | null,
  options: PlanOptions = {},
): PlannedSegment[] {
  const target = options.target ?? 30;
  const min = options.min ?? 18;
  const max = options.max ?? 42;
  const mergeTail = options.mergeTail ?? 6;
  if (!(duration > 0)) return [];
  const out: PlannedSegment[] = [];
  let start = 0;
  while (duration - start > max) {
    out.push({ start, end: quietestBetween(profile, start + min, start + max, start + target) });
    start = out[out.length - 1]!.end;
  }
  if (duration - start < mergeTail && out.length) {
    out[out.length - 1] = { start: out[out.length - 1]!.start, end: duration };
  } else {
    out.push({ start, end: duration });
  }
  return out.map((s) => ({ start: round3(s.start), end: round3(s.end) }));
}

function quietestBetween(profile: QuietProfile | null, lo: number, hi: number, preferred: number): number {
  if (!profile || !profile.energy.length) return preferred;
  const { frameMs, energy } = profile;
  const first = Math.max(0, Math.ceil((lo * 1000) / frameMs));
  const last = Math.min(energy.length - 1, Math.floor((hi * 1000) / frameMs));
  if (first > last) return preferred;
  let maxE = 0;
  for (let f = first; f <= last; f++) maxE = Math.max(maxE, energy[f]!);
  if (maxE <= 0) return preferred;
  let best = -1;
  let bestScore = Infinity;
  for (let f = first; f <= last; f++) {
    const t = (f * frameMs) / 1000;
    // Quietness dominates; distance from the preferred length only breaks near-ties.
    const score = energy[f]! / maxE + 0.25 * (Math.abs(t - preferred) / Math.max(1e-6, hi - lo));
    if (score < bestScore) {
      bestScore = score;
      best = f;
    }
  }
  // Cut in the middle of the quiet frame.
  return best < 0 ? preferred : ((best + 0.5) * frameMs) / 1000;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export interface OutputPlan {
  /** File extension of each chunk. */
  ext: string;
  /** MIME type stored with the chunk (must be accepted by the chunk upload route). */
  mime: string;
  /** Whether the stream can be copied without re-encoding. */
  copy: boolean;
}

/**
 * Container for the chunks given the input codec. Copying keeps the original
 * bits (no quality loss, no CPU); anything the transcription API would not
 * accept as-is (ALAC voice memos, AMR, Opus in CAF…) is re-encoded to AAC.
 */
export function pickOutput(codec: string | null | undefined): OutputPlan {
  const c = (codec ?? "").toLowerCase();
  if (c === "aac") return { ext: "m4a", mime: "audio/mp4", copy: true };
  if (c === "mp3") return { ext: "mp3", mime: "audio/mpeg", copy: true };
  if (c === "opus" || c === "vorbis") return { ext: "ogg", mime: "audio/ogg", copy: true };
  if (c.startsWith("pcm_")) return { ext: "wav", mime: "audio/wav", copy: true };
  return { ext: "m4a", mime: "audio/mp4", copy: false };
}

/** Extension used for the temporary file handed to the transcription API. */
export function extensionForMime(mime: string): string {
  const m = mime.split(";")[0]!.trim().toLowerCase();
  if (m === "audio/mp4") return "m4a";
  if (m === "audio/mpeg") return "mp3";
  if (m === "audio/ogg") return "ogg";
  if (m === "audio/wav") return "wav";
  if (m === "audio/webm") return "webm";
  return "bin";
}

/** "Nueva grabación 123.m4a" → "Nueva grabación 123". */
export function titleFromFileName(name: string): string {
  return (
    name
      .replace(/\.[a-z0-9]{1,5}$/i, "")
      .replace(/[_]+/g, " ")
      .trim()
      .slice(0, 200) || "Audio importado"
  );
}
