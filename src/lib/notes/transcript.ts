// Transcript consolidation for the AI pipelines: ordering, gap detection,
// block splitting with controlled overlap, excerpt extraction and reference
// handling. Pure functions, unit-tested.
import type { SegmentLanguage } from "@/lib/db/schema";
import { estimateTokens } from "@/lib/cost/pricing";
import { formatClock } from "@/lib/time";
import type { TranscriptRef } from "./types";

export interface SourceSegment {
  seq: number;
  text: string;
  status: "final" | "failed" | "gap";
  startMs: number;
  endMs: number;
  language: SegmentLanguage;
}

export interface TranscriptBlock {
  index: number;
  seqFrom: number;
  seqTo: number;
  startMs: number;
  endMs: number;
  /** Approximate token count of the block text (without overlap). */
  tokens: number;
}

export interface ConsolidatedTranscript {
  segments: SourceSegment[];
  blocks: TranscriptBlock[];
  gaps: string[];
  dominantLanguage: "es" | "en";
  languages: ("es" | "en")[];
  totalTokens: number;
  durationMs: number;
}

const BLOCK_TARGET_TOKENS = 2200;
const BLOCK_OVERLAP_SEGMENTS = 2;
const SUSPICIOUS_JUMP_MS = 120_000;

/** Marker placed before each segment so the model can cite it: ⟦s12 00:23:10⟧ */
export function segmentMarker(seq: number, startMs: number): string {
  return `⟦s${seq} ${formatClock(startMs, { forceHours: true })}⟧`;
}

export function consolidate(input: SourceSegment[]): ConsolidatedTranscript {
  const segments = [...input]
    .filter((s) => s.status === "final" || s.status === "gap")
    .sort((a, b) => a.startMs - b.startMs || a.seq - b.seq);
  const finals = segments.filter((s) => s.status === "final" && s.text.trim());
  const gaps: string[] = [];
  let prev: SourceSegment | null = null;
  for (const s of segments) {
    if (s.status === "gap") {
      gaps.push(`${formatClock(s.startMs)}: ${s.text}`);
      continue;
    }
    if (prev && s.startMs - prev.endMs > SUSPICIOUS_JUMP_MS) {
      gaps.push(
        `Salto de ${Math.round((s.startMs - prev.endMs) / 60000)} min sin transcripción entre ${formatClock(prev.endMs)} y ${formatClock(s.startMs)} (pausa, silencio o fragmento no transcrito).`,
      );
    }
    prev = s;
  }

  let es = 0;
  let en = 0;
  for (const s of finals) {
    const w = s.text.split(/\s+/).length;
    if (s.language === "es") es += w;
    else if (s.language === "en") en += w;
    else if (s.language === "mixed") {
      es += w / 2;
      en += w / 2;
    }
  }
  const dominantLanguage: "es" | "en" = en > es ? "en" : "es";
  const languages: ("es" | "en")[] = [];
  if (es > 0) languages.push("es");
  if (en > 0) languages.push("en");
  languages.sort((a, b) => (a === dominantLanguage ? -1 : b === dominantLanguage ? 1 : 0));

  const blocks: TranscriptBlock[] = [];
  let current: SourceSegment[] = [];
  let tokens = 0;
  const flush = () => {
    if (!current.length) return;
    blocks.push({
      index: blocks.length,
      seqFrom: current[0]!.seq,
      seqTo: current[current.length - 1]!.seq,
      startMs: current[0]!.startMs,
      endMs: current[current.length - 1]!.endMs,
      tokens,
    });
  };
  for (const s of finals) {
    const t = estimateTokens(s.text) + 6;
    if (tokens + t > BLOCK_TARGET_TOKENS && current.length) {
      flush();
      // Keep the tail of the previous block as context for the next one.
      current = current.slice(-BLOCK_OVERLAP_SEGMENTS);
      tokens = current.reduce((n, x) => n + estimateTokens(x.text) + 6, 0);
    }
    current.push(s);
    tokens += t;
  }
  flush();

  return {
    segments,
    blocks,
    gaps,
    dominantLanguage,
    languages,
    totalTokens: finals.reduce((n, s) => n + estimateTokens(s.text) + 6, 0),
    durationMs: segments.length ? Math.max(...segments.map((s) => s.endMs)) : 0,
  };
}

/** Transcript text for a seq range, with citation markers. */
export function renderRange(segments: readonly SourceSegment[], seqFrom: number, seqTo: number): string {
  return segments
    .filter((s) => s.status === "final" && s.seq >= seqFrom && s.seq <= seqTo && s.text.trim())
    .map((s) => `${segmentMarker(s.seq, s.startMs)} ${s.text.trim()}`)
    .join("\n");
}

export function renderRanges(
  segments: readonly SourceSegment[],
  ranges: readonly { seqFrom: number; seqTo: number }[],
  maxTokens: number,
): string {
  const seen = new Set<number>();
  const picked: SourceSegment[] = [];
  for (const r of ranges) {
    for (const s of segments) {
      if (s.status !== "final" || s.seq < r.seqFrom || s.seq > r.seqTo || seen.has(s.seq)) continue;
      seen.add(s.seq);
      picked.push(s);
    }
  }
  picked.sort((a, b) => a.startMs - b.startMs || a.seq - b.seq);
  let tokens = 0;
  const out: string[] = [];
  for (const s of picked) {
    const t = estimateTokens(s.text) + 6;
    if (tokens + t > maxTokens) break;
    tokens += t;
    out.push(`${segmentMarker(s.seq, s.startMs)} ${s.text.trim()}`);
  }
  return out.join("\n");
}

const REF_TOKEN_RE = /\[\[ref:\s*s?(\d+)\s*(?:[-–]\s*s?(\d+))?\s*\]\]/g;
const LOOSE_REF_RE = /⟦s(\d+)[^⟧]*⟧/g;

/**
 * Normalise model citations: converts `⟦s12 …⟧` markers and `[[ref:12-18]]`
 * tokens to canonical `[[ref:a-b]]`, drops references to unknown segments
 * and returns the resolved time spans.
 */
export function normalizeRefs(
  markdown: string,
  segments: readonly SourceSegment[],
): { markdown: string; refs: TranscriptRef[] } {
  const bySeq = new Map<number, SourceSegment>();
  for (const s of segments) if (s.status === "final") bySeq.set(s.seq, s);
  const refs: TranscriptRef[] = [];
  const seen = new Set<string>();
  const resolve = (a: number, b: number): TranscriptRef | null => {
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    const first = bySeq.get(from) ?? nearest(bySeq, from, to);
    const last = bySeq.get(to) ?? nearest(bySeq, from, to, true);
    if (!first || !last) return null;
    return { seqFrom: first.seq, seqTo: last.seq, startMs: first.startMs, endMs: last.endMs };
  };
  const replaceToken = (a: string, b?: string) => {
    const ref = resolve(Number(a), Number(b ?? a));
    if (!ref) return "";
    const key = `${ref.seqFrom}-${ref.seqTo}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push(ref);
    }
    return `[[ref:${key}]]`;
  };
  let out = markdown.replace(LOOSE_REF_RE, (_m, a: string) => replaceToken(a));
  out = out.replace(REF_TOKEN_RE, (_m, a: string, b?: string) => replaceToken(a, b));
  out = out.replace(/[ \t]+(\[\[ref:)/g, " $1").replace(/\n{3,}/g, "\n\n");
  refs.sort((x, y) => x.startMs - y.startMs);
  return { markdown: out, refs };
}

function nearest(bySeq: Map<number, SourceSegment>, from: number, to: number, last = false): SourceSegment | null {
  const inRange = [...bySeq.values()].filter((s) => s.seq >= from && s.seq <= to).sort((a, b) => a.seq - b.seq);
  if (!inRange.length) return null;
  return last ? inRange[inRange.length - 1]! : inRange[0]!;
}

export function describeRef(ref: TranscriptRef): string {
  return `${formatClock(ref.startMs, { forceHours: true })}–${formatClock(ref.endMs, { forceHours: true })}`;
}

/** Human description of time spans for the "Basado en la explicación entre…" captions. */
export function describeRefs(refs: readonly TranscriptRef[]): string {
  if (!refs.length) return "";
  return refs.slice(0, 4).map(describeRef).join(", ");
}
