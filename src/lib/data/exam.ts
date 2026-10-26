import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { examAttempts, examQuestions, lectureSessions, subjects, type QuestionType } from "@/lib/db/schema";
import { notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import type { QuestionView } from "./documents";

/** Question as shown before answering: no solution fields. */
export type QuestionPrompt = Omit<QuestionView, "answer" | "explanation" | "rubric" | "correctOption">;

function stripSolution(q: QuestionView): QuestionPrompt {
  const { answer: _a, explanation: _e, rubric: _r, correctOption: _c, ...rest } = q;
  void _a;
  void _e;
  void _r;
  void _c;
  return rest;
}

/**
 * Next question for an interactive session: unattempted questions first,
 * then the concepts with the lowest scores, with a random tie-break so two
 * sessions do not repeat the same order.
 */
export async function pickNextQuestion(
  db: Db,
  userId: string,
  sessionId: string,
  opts: { types?: QuestionType[]; exclude?: string[] },
): Promise<{ question: QuestionPrompt; remaining: number } | null> {
  const where = [eq(examQuestions.sessionId, sessionId), eq(examQuestions.userId, userId)];
  if (opts.types?.length) where.push(inArray(examQuestions.qtype, opts.types));
  const rows = await db
    .select({
      id: examQuestions.id,
      qtype: examQuestions.qtype,
      level: examQuestions.level,
      concept: examQuestions.concept,
      conceptKey: examQuestions.conceptKey,
      prompt: examQuestions.prompt,
      options: examQuestions.options,
      sourceRefs: examQuestions.sourceRefs,
      extendsSyllabus: examQuestions.extendsSyllabus,
      createdAt: examQuestions.createdAt,
      attempts: sql<number>`(SELECT count(*) FROM exam_attempts a WHERE a.question_id = ${examQuestions.id})`,
      lastScore: sql<
        number | null
      >`(SELECT a.score FROM exam_attempts a WHERE a.question_id = ${examQuestions.id} ORDER BY a.created_at DESC LIMIT 1)`,
      conceptScore: sql<
        number | null
      >`(SELECT avg(a.score) FROM exam_attempts a JOIN exam_questions q2 ON q2.id = a.question_id WHERE q2.concept_key = ${examQuestions.conceptKey} AND q2.user_id = ${userId})`,
    })
    .from(examQuestions)
    .where(and(...where));
  const candidates = rows.filter((r) => !opts.exclude?.includes(r.id));
  if (!candidates.length) return null;
  const scored = candidates.map((r) => {
    let priority = 0;
    if (r.attempts === 0) priority += 10;
    if (r.conceptScore !== null) priority += (1 - r.conceptScore) * 6;
    if (r.lastScore !== null) priority += (1 - r.lastScore) * 4;
    priority += Math.random();
    return { r, priority };
  });
  scored.sort((a, b) => b.priority - a.priority);
  const pick = scored[0]!.r;
  const question: QuestionPrompt = {
    id: pick.id,
    qtype: pick.qtype,
    level: pick.level,
    concept: pick.concept,
    prompt: pick.prompt,
    options: pick.options,
    sourceRefs: pick.sourceRefs,
    extendsSyllabus: pick.extendsSyllabus,
    createdAt: pick.createdAt,
  };
  return { question, remaining: candidates.length - 1 };
}

export async function getQuestionFull(
  db: Db,
  userId: string,
  questionId: string,
): Promise<QuestionView & { sessionId: string; subjectId: string | null }> {
  const [q] = await db
    .select()
    .from(examQuestions)
    .where(and(eq(examQuestions.id, questionId), eq(examQuestions.userId, userId)))
    .limit(1);
  if (!q) throw notFound("Pregunta");
  return q;
}

export async function recordAttempt(
  db: Db,
  input: {
    userId: string;
    question: { id: string; sessionId: string; subjectId: string | null };
    answer: string | null;
    selectedOption: number | null;
    score: number;
    verdict: "correct" | "partial" | "incorrect";
    feedback: string | null;
  },
) {
  const id = newId();
  await db.insert(examAttempts).values({
    id,
    userId: input.userId,
    questionId: input.question.id,
    sessionId: input.question.sessionId,
    subjectId: input.question.subjectId,
    answer: input.answer,
    selectedOption: input.selectedOption,
    score: input.score,
    verdict: input.verdict,
    feedback: input.feedback,
    createdAt: Date.now(),
  });
  return id;
}

export interface ExamProgress {
  subjectId: string | null;
  subjectName: string | null;
  attempts: number;
  averageScore: number;
  lastAttemptAt: number | null;
  weakConcepts: { concept: string; score: number; attempts: number }[];
}

export async function examProgress(db: Db, userId: string, subjectId?: string | null): Promise<ExamProgress[]> {
  const where = [eq(examAttempts.userId, userId)];
  if (subjectId) where.push(eq(examAttempts.subjectId, subjectId));
  const bySubject = await db
    .select({
      subjectId: examAttempts.subjectId,
      subjectName: subjects.name,
      attempts: sql<number>`count(*)`,
      averageScore: sql<number>`avg(${examAttempts.score})`,
      lastAttemptAt: sql<number>`max(${examAttempts.createdAt})`,
    })
    .from(examAttempts)
    .leftJoin(subjects, eq(subjects.id, examAttempts.subjectId))
    .where(and(...where))
    .groupBy(examAttempts.subjectId, subjects.name);
  const out: ExamProgress[] = [];
  for (const s of bySubject) {
    const weak = await db
      .select({
        concept: sql<string>`min(${examQuestions.concept})`,
        score: sql<number>`avg(${examAttempts.score})`,
        attempts: sql<number>`count(*)`,
      })
      .from(examAttempts)
      .innerJoin(examQuestions, eq(examQuestions.id, examAttempts.questionId))
      .where(
        and(
          eq(examAttempts.userId, userId),
          s.subjectId ? eq(examAttempts.subjectId, s.subjectId) : sql`${examAttempts.subjectId} IS NULL`,
        ),
      )
      .groupBy(examQuestions.conceptKey)
      .orderBy(sql`avg(${examAttempts.score}) ASC`)
      .limit(6);
    out.push({
      subjectId: s.subjectId,
      subjectName: s.subjectName,
      attempts: s.attempts,
      averageScore: s.averageScore ?? 0,
      lastAttemptAt: s.lastAttemptAt ?? null,
      weakConcepts: weak.filter((w) => w.score < 0.75),
    });
  }
  return out.sort((a, b) => (b.lastAttemptAt ?? 0) - (a.lastAttemptAt ?? 0));
}

export async function recentAttempts(db: Db, userId: string, sessionId: string, limit = 30) {
  return db
    .select({
      id: examAttempts.id,
      questionId: examAttempts.questionId,
      score: examAttempts.score,
      verdict: examAttempts.verdict,
      createdAt: examAttempts.createdAt,
      concept: examQuestions.concept,
      qtype: examQuestions.qtype,
    })
    .from(examAttempts)
    .innerJoin(examQuestions, eq(examQuestions.id, examAttempts.questionId))
    .where(and(eq(examAttempts.userId, userId), eq(examAttempts.sessionId, sessionId)))
    .orderBy(desc(examAttempts.createdAt))
    .limit(limit);
}

export async function lectureSubject(db: Db, sessionId: string) {
  const [row] = await db
    .select({ subjectId: lectureSessions.subjectId })
    .from(lectureSessions)
    .where(eq(lectureSessions.id, sessionId))
    .limit(1);
  return row?.subjectId ?? null;
}
