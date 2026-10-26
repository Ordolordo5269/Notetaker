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

export function estimateNotesCost(
  models: ModelConfig,
  transcriptChars: number,
  attachmentChars: number,
  blocks: number,
): CostEstimate {
  const t = estimateTokens("x".repeat(transcriptChars));
  const a = estimateTokens("x".repeat(attachmentChars));
  const sections = Math.max(5, Math.min(18, Math.round(blocks * 1.2) + 4));
  const extraction = tokenCost(models.fast, t * 1.15 + blocks * 900, 0, blocks * 900);
  const outline = tokenCost(models.notes, blocks * 1200 + 1500, 0, 2500);
  const drafts = tokenCost(models.notes, sections * 2200 + t * 1.3 + a * 0.6, 0, sections * 1400 + t * 0.9);
  const review = tokenCost(models.notes, t * 1.2 + blocks * 900, 0, 2500);
  const patches = drafts * 0.2;
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
  recovery_transcription: "Transcripción de recuperación",
};
