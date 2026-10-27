// Orientative figures shown in Ajustes so the user can see what each preference costs.
// They come from the bundled price table and the same estimator used before launching
// a job; real spend is recorded per call in usage_events.
import { audioCost } from "@/lib/cost/pricing";
import { estimateNotesCost } from "@/lib/notes/estimate";
import type { ModelConfig } from "@/lib/env";

/** A typical two-hour lecture, scaled from the measured 88-minute fixture (~920 transcript characters per minute, one block per ~5.5 minutes). */
export const REFERENCE_CLASS = { minutes: 120, transcriptChars: 110_000, blocks: 15 };

export interface CostOutlook {
  /** Transcription cost per recorded hour, by mode. */
  transcriptionPerHour: { realtime: number; turns: number };
  /** Full notes for the reference two-hour class, by quality. */
  notesTwoHours: { max: number; economy: number };
  referenceMinutes: number;
}

export function costOutlook(models: ModelConfig): CostOutlook {
  const { transcriptChars, blocks, minutes } = REFERENCE_CLASS;
  return {
    transcriptionPerHour: {
      realtime: audioCost(models.live, 3600),
      turns: audioCost(models.file, 3600),
    },
    notesTwoHours: {
      max: estimateNotesCost(models, transcriptChars, 0, blocks, "max").usd,
      economy: estimateNotesCost(models, transcriptChars, 0, blocks, "economy").usd,
    },
    referenceMinutes: minutes,
  };
}
