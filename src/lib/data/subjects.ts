import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { subjects, type SubjectColor } from "@/lib/db/schema";
import { notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { sanitizeKeywords } from "@/lib/transcription/session-config";

export interface SubjectSummary {
  id: string;
  name: string;
  color: SubjectColor;
  keywords: string[];
  description: string | null;
  archivedAt: number | null;
  lectureCount: number;
  lastLectureAt: number | null;
  createdAt: number;
}

export async function listSubjects(db: Db, userId: string, opts: { includeArchived?: boolean } = {}) {
  const rows = await db
    .select({
      id: subjects.id,
      name: subjects.name,
      color: subjects.color,
      keywords: subjects.keywords,
      description: subjects.description,
      archivedAt: subjects.archivedAt,
      createdAt: subjects.createdAt,
      lectureCount: sql<number>`(SELECT count(*) FROM lecture_sessions l WHERE l.subject_id = ${subjects.id} AND l.user_id = ${userId})`,
      lastLectureAt: sql<
        number | null
      >`(SELECT max(l.created_at) FROM lecture_sessions l WHERE l.subject_id = ${subjects.id} AND l.user_id = ${userId})`,
    })
    .from(subjects)
    .where(and(eq(subjects.userId, userId), opts.includeArchived ? undefined : isNull(subjects.archivedAt)))
    .orderBy(asc(subjects.name));
  return rows satisfies SubjectSummary[];
}

export async function getSubject(db: Db, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(subjects)
    .where(and(eq(subjects.id, id), eq(subjects.userId, userId)))
    .limit(1);
  if (!row) throw notFound("Asignatura");
  return row;
}

export async function createSubject(
  db: Db,
  userId: string,
  input: { name: string; color: SubjectColor; keywords?: string[]; description?: string | null },
) {
  const now = Date.now();
  const id = newId();
  await db.insert(subjects).values({
    id,
    userId,
    name: input.name.trim(),
    color: input.color,
    keywords: sanitizeKeywords(input.keywords ?? []),
    description: input.description?.trim() || null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  return getSubject(db, userId, id);
}

export async function updateSubject(
  db: Db,
  userId: string,
  id: string,
  input: Partial<{
    name: string;
    color: SubjectColor;
    keywords: string[];
    description: string | null;
    archived: boolean;
  }>,
) {
  await getSubject(db, userId, id);
  await db
    .update(subjects)
    .set({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.keywords !== undefined ? { keywords: sanitizeKeywords(input.keywords) } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.archived !== undefined ? { archivedAt: input.archived ? Date.now() : null } : {}),
      updatedAt: Date.now(),
    })
    .where(and(eq(subjects.id, id), eq(subjects.userId, userId)));
  return getSubject(db, userId, id);
}

/** Deleting a subject keeps its lectures (they become "Sin asignatura"). */
export async function deleteSubject(db: Db, userId: string, id: string) {
  await getSubject(db, userId, id);
  await db.delete(subjects).where(and(eq(subjects.id, id), eq(subjects.userId, userId)));
}
