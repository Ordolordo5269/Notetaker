import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { lectureSessions, profiles, subjects } from "@/lib/db/schema";
import type { TranscriptionDelay } from "@/lib/transcription/session-config";
import { notFound } from "@/lib/errors";

/** Everything needed to configure transcription for one lecture. */
export async function getTranscriptionContext(db: Db, userId: string, sessionId: string) {
  const [row] = await db
    .select({
      status: lectureSessions.status,
      title: lectureSessions.title,
      lectureKeywords: lectureSessions.keywords,
      subjectName: subjects.name,
      subjectKeywords: subjects.keywords,
    })
    .from(lectureSessions)
    .leftJoin(subjects, and(eq(subjects.id, lectureSessions.subjectId), eq(subjects.userId, userId)))
    .where(and(eq(lectureSessions.id, sessionId), eq(lectureSessions.userId, userId)))
    .limit(1);
  if (!row) throw notFound("Clase");
  const [profile] = await db
    .select({ delay: profiles.transcriptionDelay })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  return {
    status: row.status,
    lectureTitle: row.title,
    subjectName: row.subjectName,
    keywords: [...(row.subjectKeywords ?? []), ...(row.lectureKeywords ?? [])],
    delay: (profile?.delay ?? "medium") as TranscriptionDelay,
  };
}
