// Spaced repetition scheduling (SM-2 variant with four grades).
// Pure function, unit-tested. Intervals are in days; `dueAt` is a timestamp.
import type { ReviewGrade } from "@/lib/db/schema";

export interface CardState {
  ease: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
}

export interface ScheduledCard extends CardState {
  dueAt: number;
}

const DAY = 86_400_000;
const MIN_EASE = 1.3;

export function scheduleReview(card: CardState, grade: ReviewGrade, now = Date.now()): ScheduledCard {
  let { ease, intervalDays, repetitions, lapses } = card;
  switch (grade) {
    case "again":
      lapses += 1;
      repetitions = 0;
      ease = Math.max(MIN_EASE, ease - 0.2);
      intervalDays = 0; // again today (10 minutes)
      return { ease, intervalDays, repetitions, lapses, dueAt: now + 10 * 60_000 };
    case "hard":
      ease = Math.max(MIN_EASE, ease - 0.15);
      intervalDays = repetitions === 0 ? 0.5 : Math.max(1, intervalDays * 1.2);
      repetitions += 1;
      break;
    case "good":
      intervalDays = repetitions === 0 ? 1 : repetitions === 1 ? 3 : Math.max(1, intervalDays * ease);
      repetitions += 1;
      break;
    case "easy":
      ease = Math.min(3.0, ease + 0.15);
      intervalDays = repetitions === 0 ? 3 : repetitions === 1 ? 6 : Math.max(1, intervalDays * ease * 1.3);
      repetitions += 1;
      break;
  }
  intervalDays = Math.min(365, Math.round(intervalDays * 100) / 100);
  return { ease, intervalDays, repetitions, lapses, dueAt: now + intervalDays * DAY };
}

export const GRADE_LABEL: Record<ReviewGrade, string> = {
  again: "No lo sabía",
  hard: "Difícil",
  good: "Bien",
  easy: "Fácil",
};

/** Human preview of the next interval for a grade button. */
export function previewInterval(card: CardState, grade: ReviewGrade): string {
  const next = scheduleReview(card, grade, 0);
  if (grade === "again") return "10 min";
  if (next.intervalDays < 1) return `${Math.round(next.intervalDays * 24)} h`;
  if (next.intervalDays < 30) return `${Math.round(next.intervalDays)} d`;
  return `${(next.intervalDays / 30).toFixed(1)} meses`;
}
