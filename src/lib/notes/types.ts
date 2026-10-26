// Shared contracts for AI-generated study material.
import { z } from "zod";
import type { DocumentLanguage } from "@/lib/db/schema";

/** A span of the lecture a statement is based on (segment sequence numbers). */
export interface TranscriptRef {
  seqFrom: number;
  seqTo: number;
  startMs: number;
  endMs: number;
}

export interface DocumentSection {
  id: string;
  heading: string;
  /** 1 = top-level section, 2 = subsection. */
  level: 1 | 2;
  /** GitHub-flavoured Markdown. Inline refs use the token [[ref:12-18]]. */
  markdown: string;
  refs: TranscriptRef[];
  /** Passages the model flagged as unclear or contradictory in the recording. */
  ambiguities: string[];
  /** Set when the user edited this section by hand. */
  edited?: boolean;
}

export interface StudyDocumentContent {
  version: 1;
  title: string;
  language: DocumentLanguage;
  sections: DocumentSection[];
  meta: {
    generatedAt: number;
    model: string | null;
    /** Items from the extraction checklist the review could not place. */
    uncovered: string[];
    /** Unrecorded intervals or suspicious jumps in the transcript. */
    gaps: string[];
    wordCount: number;
    sourceSegments: number;
    attachments: string[];
  };
}

export const transcriptRefSchema = z.object({
  seqFrom: z.number().int().min(0),
  seqTo: z.number().int().min(0),
  startMs: z.number().min(0),
  endMs: z.number().min(0),
});

export const documentSectionSchema = z.object({
  id: z.string().min(1).max(80),
  heading: z.string().min(1).max(300),
  level: z.union([z.literal(1), z.literal(2)]),
  markdown: z.string().max(200_000),
  refs: z.array(transcriptRefSchema).max(500),
  ambiguities: z.array(z.string().max(2000)).max(100),
  edited: z.boolean().optional(),
});

export const studyDocumentContentSchema = z.object({
  version: z.literal(1),
  title: z.string().min(1).max(300),
  language: z.enum(["es", "en", "bilingual"]),
  sections: z.array(documentSectionSchema).max(400),
  meta: z.object({
    generatedAt: z.number(),
    model: z.string().nullable(),
    uncovered: z.array(z.string()).max(500),
    gaps: z.array(z.string()).max(200),
    wordCount: z.number(),
    sourceSegments: z.number(),
    attachments: z.array(z.string()).max(50),
  }),
});

export function countWords(text: string): number {
  return (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;
}

export function documentWordCount(doc: StudyDocumentContent): number {
  return doc.sections.reduce((n, s) => n + countWords(s.markdown), 0);
}

/** Plain text used for full-text search. */
export function documentPlainText(doc: StudyDocumentContent): string {
  return doc.sections
    .map((s) => `${s.heading}\n${s.markdown}`)
    .join("\n\n")
    .replace(/\[\[ref:[^\]]*\]\]/g, "")
    .replace(/[#*_>`|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const LANGUAGE_LABEL: Record<DocumentLanguage | "auto", string> = {
  auto: "Automático",
  es: "Español",
  en: "Inglés",
  bilingual: "Bilingüe",
};
