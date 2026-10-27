// Cost estimates shown before launching a job. They are planning figures
// based on token heuristics and the bundled price table, not invoices.
import { estimateTokens, tokenCost } from "@/lib/cost/pricing";
import type { ModelConfig } from "@/lib/env";
import type { JobType } from "@/lib/db/schema";

export interface CostEstimate {
  usd: number;
  breakdown: { label: string; usd: number }[];
  transcriptTokens: number;
}

export type NotesQuality = "max" | "economy";

/** The outline is capped at this many sections in the pipeline (sanitizeOutline). */
export const MAX_OUTLINE_SECTIONS = 40;

/** Model that drafts and reviews the sections for a given quality setting. */
export function draftingModel(models: ModelConfig, quality: NotesQuality): string {
  return quality === "economy" ? models.fast : models.notes;
}

/**
 * Calibrated against real runs (2026-10): an 18-minute class (2 blocks) cost 0.36 $ and an
 * 88-minute class (11 blocks, 40 sections, 24k words) cost 1.88 $ with the default models.
 * The outline produces roughly 16 + 2.4 sections per block; each section reads up to ~9k
 * tokens of transcript plus prompt/digest context and writes ~600 words.
 */
export function estimateNotesCost(
  models: ModelConfig,
  transcriptChars: number,
  attachmentChars: number,
  blocks: number,
  quality: NotesQuality = "max",
): CostEstimate {
  const t = estimateTokens("x".repeat(transcriptChars));
  const a = estimateTokens("x".repeat(attachmentChars));
  const sections = Math.min(MAX_OUTLINE_SECTIONS, Math.max(8, Math.round(16 + 2.4 * blocks)));
  const drafter = draftingModel(models, quality);
  const extraction = tokenCost(models.fast, t * 1.15 + blocks * 900, 0, blocks * 1200);
  // The outline always uses the notes model: the structure decides the quality of the whole document.
  const outline = tokenCost(models.notes, blocks * 1600 + 2500, 0, 2500 + blocks * 400);
  // Short classes feed each section a slice of the whole transcript and write shorter sections;
  // long classes hit the per-section context cap and write ~600-word sections.
  const perSectionIn = Math.min(t * 0.8, 11_000) + 3500 + Math.min(a, 3000);
  const perSectionOut = 1250 * Math.min(1, 0.5 + t / 40_000);
  // Parent sections are short overviews, so not every section costs a full draft.
  const drafts = 0.8 * sections * tokenCost(drafter, perSectionIn, 0, perSectionOut);
  const review = tokenCost(drafter, t * 1.3 + blocks * 1200 + sections * perSectionOut * 0.7, 0, 3000 + blocks * 300);
  const patches = drafts * 0.15;
  const breakdown = [
    { label: "Extracción por bloques", usd: extraction },
    { label: "Índice global", usd: outline },
    { label: "Redacción de secciones", usd: drafts },
    { label: "Revisión de cobertura", usd: review + patches },
  ];
  return { usd: breakdown.reduce((n, b) => n + b.usd, 0), breakdown, transcriptTokens: t };
}

export function estimateSummariesCost(models: ModelConfig, notesChars: number): CostEstimate {
  const t = estimateTokens("x".repeat(notesChars));
  const perMode = tokenCost(models.notes, t + 1200, 0, 1800);
  return {
    usd: perMode * 3,
    breakdown: [{ label: "Tres modos de repaso", usd: perMode * 3 }],
    transcriptTokens: t,
  };
}

export function estimateExamCost(models: ModelConfig, notesChars: number, questionCount: number): CostEstimate {
  const t = estimateTokens("x".repeat(notesChars));
  const calls = Math.max(1, Math.ceil(questionCount / 12));
  const usd = tokenCost(models.notes, calls * (t + 1500), 0, questionCount * 350);
  return { usd, breakdown: [{ label: `${questionCount} preguntas`, usd }], transcriptTokens: t };
}

export function estimateFlashcardsCost(models: ModelConfig, notesChars: number): CostEstimate {
  const t = estimateTokens("x".repeat(notesChars));
  const usd = tokenCost(models.fast, t + 1200, 0, 4000);
  return { usd, breakdown: [{ label: "Tarjetas", usd }], transcriptTokens: t };
}

/** One section redrafted from its transcript spans plus the previous draft. */
export function estimateSectionCost(models: ModelConfig, excerptChars: number): CostEstimate {
  const t = estimateTokens("x".repeat(excerptChars));
  const draft = tokenCost(models.notes, t + 2500, 0, 2500);
  return { usd: draft, breakdown: [{ label: "Redacción de la sección", usd: draft }], transcriptTokens: t };
}

export const JOB_LABEL: Record<JobType, string> = {
  notes: "Apuntes completos",
  summaries: "Resúmenes",
  exam: "Preguntas de examen",
  flashcards: "Flashcards",
  attachment: "Procesado de documento",
  index: "Índice de búsqueda",
  section: "Sección de apuntes",
  recovery_transcription: "Transcripción del audio",
};
