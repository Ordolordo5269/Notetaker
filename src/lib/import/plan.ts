// Pure planning helpers for importing an audio file: where to cut it into
// chunks and which container to write. No browser or ffmpeg dependency, so
// they are unit-tested directly.

export interface Silence {
  /** Seconds from the start of the file. */
  start: number;
  end: number;
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
 * Chunk boundaries for a file of `duration` seconds. Each chunk ends in the
 * longest pause found between `min` and `max` seconds after it starts (ties go
 * to the pause closest to `target`); without a pause it ends at `target`.
 * Chunks never overlap, so the transcript has no duplicated text, and they
 * stay short enough for the file transcription model and for seeking.
 */
export function planSegments(
  duration: number,
  silences: readonly Silence[],
  options: PlanOptions = {},
): PlannedSegment[] {
  const target = options.target ?? 30;
  const min = options.min ?? 18;
  const max = options.max ?? 42;
  const mergeTail = options.mergeTail ?? 6;
  if (!(duration > 0)) return [];
  const sorted = [...silences].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  const out: PlannedSegment[] = [];
  let start = 0;
  while (duration - start > max) {
    const lo = start + min;
    const hi = start + max;
    let best: { at: number; score: number } | null = null;
    for (const s of sorted) {
      const mid = (s.start + s.end) / 2;
      if (mid < lo) continue;
      if (mid > hi) break;
      const length = s.end - s.start;
      // Longer pauses win; among similar pauses prefer the one nearest the target length.
      const score = length * 10 - Math.abs(mid - (start + target)) * 0.1;
      if (!best || score > best.score) best = { at: mid, score };
    }
    const end = best ? best.at : start + target;
    out.push({ start, end });
    start = end;
  }
  if (duration - start < mergeTail && out.length) {
    out[out.length - 1] = { start: out[out.length - 1]!.start, end: duration };
  } else {
    out.push({ start, end: duration });
  }
  return out.map((s) => ({ start: round3(s.start), end: round3(s.end) }));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Parses ffmpeg's `silencedetect` log lines into pauses. */
export function parseSilences(log: string): Silence[] {
  const out: Silence[] = [];
  let pendingStart: number | null = null;
  for (const line of log.split(/\r?\n/)) {
    const start = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (start) {
      pendingStart = Number(start[1]);
      continue;
    }
    const end = /silence_end:\s*(-?[\d.]+)/.exec(line);
    if (end && pendingStart !== null) {
      out.push({ start: Math.max(0, pendingStart), end: Number(end[1]) });
      pendingStart = null;
    }
  }
  return out;
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
