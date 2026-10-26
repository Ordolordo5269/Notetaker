import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import {
  flashcardReviews,
  flashcards,
  lectureSessions,
  subjects,
  type ReviewGrade,
  type SourceRef,
} from "@/lib/db/schema";
import { notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { scheduleReview } from "@/lib/study/srs";

export interface FlashcardView {
  id: string;
  sessionId: string | null;
  lectureTitle: string | null;
  subjectId: string | null;
  subjectName: string | null;
  cardType: string;
  front: string;
  back: string;
  sourceRefs: SourceRef[];
  ease: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  dueAt: number;
  lastReviewedAt: number | null;
  suspended: boolean;
}

const columns = {
  id: flashcards.id,
  sessionId: flashcards.sessionId,
  lectureTitle: lectureSessions.title,
  subjectId: flashcards.subjectId,
  subjectName: subjects.name,
  cardType: flashcards.cardType,
  front: flashcards.front,
  back: flashcards.back,
  sourceRefs: flashcards.sourceRefs,
  ease: flashcards.ease,
  intervalDays: flashcards.intervalDays,
  repetitions: flashcards.repetitions,
  lapses: flashcards.lapses,
  dueAt: flashcards.dueAt,
  lastReviewedAt: flashcards.lastReviewedAt,
  suspended: flashcards.suspended,
};

export async function listFlashcards(
  db: Db,
  userId: string,
  opts: { sessionId?: string; subjectId?: string | null; dueOnly?: boolean; limit?: number } = {},
): Promise<FlashcardView[]> {
  const where = [eq(flashcards.userId, userId)];
  if (opts.sessionId) where.push(eq(flashcards.sessionId, opts.sessionId));
  if (opts.subjectId) where.push(eq(flashcards.subjectId, opts.subjectId));
  if (opts.dueOnly) {
    where.push(eq(flashcards.suspended, false));
    where.push(lte(flashcards.dueAt, Date.now()));
  }
  return db
    .select(columns)
    .from(flashcards)
    .leftJoin(lectureSessions, eq(lectureSessions.id, flashcards.sessionId))
    .leftJoin(subjects, eq(subjects.id, flashcards.subjectId))
    .where(and(...where))
    .orderBy(asc(flashcards.dueAt), asc(flashcards.createdAt))
    .limit(opts.limit ?? 500);
}

export interface ReviewSummary {
  subjectId: string | null;
  subjectName: string | null;
  due: number;
  total: number;
  nextDueAt: number | null;
}

export async function reviewSummary(db: Db, userId: string): Promise<ReviewSummary[]> {
  const now = Date.now();
  const rows = await db
    .select({
      subjectId: flashcards.subjectId,
      subjectName: subjects.name,
      due: sql<number>`sum(case when ${flashcards.suspended} = 0 and ${flashcards.dueAt} <= ${now} then 1 else 0 end)`,
      total: sql<number>`sum(case when ${flashcards.suspended} = 0 then 1 else 0 end)`,
      nextDueAt: sql<
        number | null
      >`min(case when ${flashcards.suspended} = 0 and ${flashcards.dueAt} > ${now} then ${flashcards.dueAt} end)`,
    })
    .from(flashcards)
    .leftJoin(subjects, eq(subjects.id, flashcards.subjectId))
    .where(eq(flashcards.userId, userId))
    .groupBy(flashcards.subjectId, subjects.name);
  return rows.sort((a, b) => b.due - a.due);
}

export async function gradeFlashcard(db: Db, userId: string, cardId: string, grade: ReviewGrade) {
  const [card] = await db
    .select()
    .from(flashcards)
    .where(and(eq(flashcards.id, cardId), eq(flashcards.userId, userId)))
    .limit(1);
  if (!card) throw notFound("Tarjeta");
  const now = Date.now();
  const next = scheduleReview(card, grade, now);
  await db.batch([
    db
      .update(flashcards)
      .set({
        ease: next.ease,
        intervalDays: next.intervalDays,
        repetitions: next.repetitions,
        lapses: next.lapses,
        dueAt: next.dueAt,
        lastReviewedAt: now,
        updatedAt: now,
      })
      .where(eq(flashcards.id, cardId)),
    db.insert(flashcardReviews).values({
      id: newId(),
      userId,
      flashcardId: cardId,
      grade,
      prevIntervalDays: card.intervalDays,
      nextIntervalDays: next.intervalDays,
      prevEase: card.ease,
      nextEase: next.ease,
      reviewedAt: now,
    }),
  ]);
  return { ...next, dueAt: next.dueAt };
}

export async function updateFlashcard(
  db: Db,
  userId: string,
  cardId: string,
  patch: Partial<{ suspended: boolean; front: string; back: string }>,
) {
  const [card] = await db
    .select({ id: flashcards.id })
    .from(flashcards)
    .where(and(eq(flashcards.id, cardId), eq(flashcards.userId, userId)))
    .limit(1);
  if (!card) throw notFound("Tarjeta");
  await db
    .update(flashcards)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(flashcards.id, cardId));
}

export async function deleteFlashcard(db: Db, userId: string, cardId: string) {
  await db.delete(flashcards).where(and(eq(flashcards.id, cardId), eq(flashcards.userId, userId)));
}
