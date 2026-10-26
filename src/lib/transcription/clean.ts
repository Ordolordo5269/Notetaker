// Deterministic "clean" view of a transcript: paragraphs and optional filler
// removal. No model involved: meaning, language and wording stay as spoken.
// The original segments are never modified.
import type { SegmentLanguage } from "@/lib/db/schema";
import { formatClock } from "@/lib/time";

export interface CleanableSegment {
  seq: number;
  text: string;
  startMs: number;
  endMs: number;
  status: "final" | "failed" | "gap";
  language: SegmentLanguage;
}

export interface Paragraph {
  startMs: number;
  endMs: number;
  text: string;
  seqFrom: number;
  seqTo: number;
  language: SegmentLanguage;
  gap?: boolean;
}

// Pure hesitation sounds in Spanish and English. Discourse markers and
// demonstratives that can carry meaning ("bueno", "o sea", "este", "like")
// are deliberately kept: removing them could change what was said.
const FILLER_RE = /(^|[\s(,;:—-])(?:e+h+|e+m+|m+h*m*|u+h+|u+m+|a+h+|e+r+m*|hmm+|mmm+)(?=[\s,.;:!?)—-]|$)/giu;

export function removeFillers(text: string): string {
  return text
    .replace(FILLER_RE, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:])\s*\1+/g, "$1")
    .replace(/^[,;:\s]+/, "")
    .replace(/\s*,\s*\./g, ".")
    .trim()
    .replace(/^(\p{Ll})/u, (m) => m.toUpperCase());
}

/** Group consecutive segments into paragraphs on long pauses or language changes. */
export function buildParagraphs(
  segments: readonly CleanableSegment[],
  opts: { removeFillers?: boolean; pauseMs?: number } = {},
): Paragraph[] {
  const pause = opts.pauseMs ?? 3500;
  const out: Paragraph[] = [];
  let current: Paragraph | null = null;
  for (const s of segments) {
    if (s.status === "gap") {
      if (current) out.push(current);
      current = null;
      out.push({
        startMs: s.startMs,
        endMs: s.endMs,
        text: s.text,
        seqFrom: s.seq,
        seqTo: s.seq,
        language: "und",
        gap: true,
      });
      continue;
    }
    if (s.status !== "final") continue;
    const text = opts.removeFillers ? removeFillers(s.text) : s.text.trim();
    if (!text) continue;
    const langChanged =
      current && current.language !== "und" && s.language !== "und" && current.language !== s.language;
    const longPause = current && s.startMs - current.endMs > pause;
    const tooLong = current && current.text.length > 1200;
    if (!current || langChanged || longPause || tooLong) {
      if (current) out.push(current);
      current = { startMs: s.startMs, endMs: s.endMs, text, seqFrom: s.seq, seqTo: s.seq, language: s.language };
    } else {
      current.text += (/[.!?…]$/.test(current.text) ? " " : " ") + text;
      current.endMs = s.endMs;
      current.seqTo = s.seq;
      if (current.language === "und") current.language = s.language;
      else if (s.language === "mixed" || (s.language !== "und" && s.language !== current.language))
        current.language = "mixed";
    }
  }
  if (current) out.push(current);
  return out;
}

export function transcriptToText(segments: readonly CleanableSegment[], opts: { timestamps?: boolean } = {}): string {
  return segments
    .filter((s) => s.status === "final" || s.status === "gap")
    .map((s) => (opts.timestamps ? `[${formatClock(s.startMs)}] ${s.text}` : s.text))
    .join("\n");
}

export function transcriptToMarkdown(
  title: string,
  meta: { subject?: string | null; date?: string; duration?: string },
  segments: readonly CleanableSegment[],
  opts: { clean?: boolean; removeFillers?: boolean } = {},
): string {
  const lines = [`# ${title}`, ""];
  const metaLine = [meta.subject, meta.date, meta.duration].filter(Boolean).join(" · ");
  if (metaLine) lines.push(`_${metaLine}_`, "");
  if (opts.clean) {
    for (const p of buildParagraphs(segments, { removeFillers: opts.removeFillers })) {
      lines.push(p.gap ? `> ${formatClock(p.startMs)} — ${p.text}` : `**${formatClock(p.startMs)}** ${p.text}`, "");
    }
  } else {
    for (const s of segments) {
      if (s.status === "gap") lines.push(`> ${formatClock(s.startMs)} — ${s.text}`, "");
      else if (s.status === "final") lines.push(`**${formatClock(s.startMs)}** ${s.text}`, "");
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}

/** Trigger a client-side download of generated text. */
export function downloadText(fileName: string, content: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeFileName(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9-_ ]+/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "clase"
  );
}
