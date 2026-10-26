// Validation and cost estimation for user-triggered jobs.
import { z } from "zod";
import type { Db } from "@/lib/db";
import type { AppConfig } from "@/lib/env";
import { badRequest } from "@/lib/errors";
import { getCurrentContent, loadAttachmentPages, loadSourceSegments } from "@/lib/data/documents";
import { getProfile } from "@/lib/data/profile";
import { consolidate } from "@/lib/notes/transcript";
import {
  estimateExamCost,
  estimateFlashcardsCost,
  estimateNotesCost,
  estimateSectionCost,
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
    // Omitted = the user's preference in Ajustes (see withProfileDefaults).
    quality: z.enum(["max", "economy"]).optional(),
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
  z.object({
    type: z.literal("section"),
    sectionId: z.string().min(1).max(80),
    instructions: z.string().max(600).optional(),
    language,
  }),
]);

export type JobRequest = z.infer<typeof jobRequestSchema>;

/** Fill request fields the client left out with the user's saved preferences. */
export async function withProfileDefaults(db: Db, userId: string, req: JobRequest): Promise<JobRequest> {
  if (req.type !== "notes" || req.quality) return req;
  const profile = await getProfile(db, userId);
  return { ...req, quality: profile.notesQuality };
}

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
        ...estimateNotesCost(
          config.models,
          transcriptChars,
          attachmentChars,
          transcript.blocks.length,
          req.quality ?? "max",
        ),
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
    case "section": {
      if (!notes) throw badRequest("No hay apuntes que regenerar.");
      const section = notes.content.sections.find((s) => s.id === req.sectionId);
      if (!section) throw badRequest("La sección no existe en la versión actual de los apuntes.");
      const inSpan = (seq: number) => section.refs.some((r) => seq >= r.seqFrom && seq <= r.seqTo);
      const spanChars = transcript.segments.reduce(
        (n, s) => n + (s.status === "final" && inSpan(s.seq) ? s.text.length : 0),
        0,
      );
      const excerptChars = Math.min(spanChars || transcriptChars, 45_000);
      return { ...estimateSectionCost(config.models, excerptChars + section.markdown.length), ...base };
    }
  }
}

export function dedupeKeyFor(sessionId: string, req: JobRequest): string {
  return req.type === "section" ? `section:${sessionId}:${req.sectionId}` : `${req.type}:${sessionId}`;
}

export function paramsFor(req: JobRequest): Record<string, unknown> {
  const params: Record<string, unknown> = { ...req };
  delete params.type;
  return params;
}
