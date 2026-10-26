// Validation and cost estimation for user-triggered jobs.
import { z } from "zod";
import type { Db } from "@/lib/db";
import type { AppConfig } from "@/lib/env";
import { badRequest } from "@/lib/errors";
import { getCurrentContent, loadAttachmentPages, loadSourceSegments } from "@/lib/data/documents";
import { consolidate } from "@/lib/notes/transcript";
import {
  estimateExamCost,
  estimateFlashcardsCost,
  estimateNotesCost,
  estimateSummariesCost,
  type CostEstimate,
} from "@/lib/notes/estimate";
import { documentPlainText } from "@/lib/notes/types";

const language = z.enum(["auto", "es", "en", "bilingual"]).default("auto");

export const jobRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("notes"),
    language,
    includeAttachments: z.boolean().default(true),
    label: z.string().max(120).optional(),
  }),
  z.object({
    type: z.literal("summaries"),
    language,
    modes: z
      .array(z.enum(["summary_quick", "summary_full", "summary_last_minute"]))
      .min(1)
      .optional(),
  }),
  z.object({
    type: z.literal("exam"),
    language,
    counts: z.object({
      mcq: z.number().int().min(0).max(40).default(0),
      short: z.number().int().min(0).max(40).default(0),
      essay: z.number().int().min(0).max(20).default(0),
      oral: z.number().int().min(0).max(40).default(0),
      case: z.number().int().min(0).max(20).default(0),
    }),
    replace: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("flashcards"),
    language,
    maxCards: z.number().int().min(5).max(120).default(40),
  }),
]);

export type JobRequest = z.infer<typeof jobRequestSchema>;

export async function estimateJob(
  db: Db,
  config: AppConfig,
  userId: string,
  sessionId: string,
  req: JobRequest,
): Promise<CostEstimate & { transcriptSegments: number; hasNotes: boolean }> {
  const segments = await loadSourceSegments(db, userId, sessionId);
  const transcript = consolidate(segments);
  const transcriptChars = transcript.segments.reduce((n, s) => n + (s.status === "final" ? s.text.length : 0), 0);
  const notes = await getCurrentContent(db, userId, sessionId, "notes");
  const notesChars = notes ? documentPlainText(notes.content).length : transcriptChars;
  const base = {
    transcriptSegments: transcript.blocks.length ? transcript.segments.length : 0,
    hasNotes: Boolean(notes),
  };
  switch (req.type) {
    case "notes": {
      if (!transcript.blocks.length)
        throw badRequest("La clase no tiene transcripción suficiente para generar apuntes.");
      const attachmentChars = req.includeAttachments
        ? (await loadAttachmentPages(db, userId, sessionId)).reduce((n, p) => n + p.text.length, 0)
        : 0;
      return {
        ...estimateNotesCost(config.models, transcriptChars, attachmentChars, transcript.blocks.length),
        ...base,
      };
    }
    case "summaries":
      if (!notes) throw badRequest("Genera primero los apuntes completos.");
      return { ...estimateSummariesCost(config.models, notesChars), ...base };
    case "exam": {
      const total = Object.values(req.counts).reduce((n, v) => n + v, 0);
      if (total === 0) throw badRequest("Indica cuántas preguntas quieres de cada tipo.");
      if (!transcript.blocks.length) throw badRequest("La clase no tiene transcripción suficiente.");
      return { ...estimateExamCost(config.models, notesChars, total), ...base };
    }
    case "flashcards":
      if (!transcript.blocks.length) throw badRequest("La clase no tiene transcripción suficiente.");
      return { ...estimateFlashcardsCost(config.models, notesChars), ...base };
  }
}

export function dedupeKeyFor(sessionId: string, req: JobRequest): string {
  return `${req.type}:${sessionId}`;
}

export function paramsFor(req: JobRequest): Record<string, unknown> {
  const { type: _type, ...rest } = req;
  return rest;
}
