import { and, asc, desc, eq, inArray, lt, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { chunkForInsert } from "@/lib/db";
import {
  audioChunks,
  lectureMarkers,
  lectureSessions,
  subjects,
  transcriptSegments,
  type MarkerType,
  type SegmentLanguage,
  type SegmentSource,
  type SessionStatus,
} from "@/lib/db/schema";
import { conflict, notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { canTransition } from "@/lib/sessions/state-machine";
import { lectureLanguages } from "@/lib/transcription/language";
import { deletePrefix, sessionPrefix } from "@/lib/storage/keys";

export interface LectureCard {
  id: string;
  title: string;
  subjectId: string | null;
  subjectName: string | null;
  subjectColor: string | null;
  status: SessionStatus;
  processingStatus: string;
  durationMs: number;
  startedAt: number | null;
  createdAt: number;
  lastHeartbeatAt: number | null;
  languages: string[];
  transcriptionMode: string | null;
  hasNotes: boolean;
  importantCount: number;
  examCount: number;
  confusedCount: number;
  segmentCount: number;
}

const cardColumns = (userId: string) => ({
  id: lectureSessions.id,
  title: lectureSessions.title,
  subjectId: lectureSessions.subjectId,
  subjectName: subjects.name,
  subjectColor: subjects.color,
  status: lectureSessions.status,
  processingStatus: lectureSessions.processingStatus,
  durationMs: lectureSessions.durationMs,
  startedAt: lectureSessions.startedAt,
  createdAt: lectureSessions.createdAt,
  lastHeartbeatAt: lectureSessions.lastHeartbeatAt,
  languages: lectureSessions.languages,
  transcriptionMode: lectureSessions.transcriptionMode,
  hasNotes: sql<number>`EXISTS (SELECT 1 FROM study_documents d WHERE d.session_id = ${lectureSessions.id} AND d.kind = 'notes' AND d.user_id = ${userId} AND d.current_version_id IS NOT NULL)`,
  importantCount: sql<number>`(SELECT count(*) FROM lecture_markers m WHERE m.session_id = ${lectureSessions.id} AND m.type = 'important')`,
  examCount: sql<number>`(SELECT count(*) FROM lecture_markers m WHERE m.session_id = ${lectureSessions.id} AND m.type = 'exam')`,
  confusedCount: sql<number>`(SELECT count(*) FROM lecture_markers m WHERE m.session_id = ${lectureSessions.id} AND m.type = 'confused')`,
  segmentCount: sql<number>`(SELECT count(*) FROM transcript_segments t WHERE t.session_id = ${lectureSessions.id} AND t.status = 'final')`,
});

function toCard(row: Record<string, unknown>): LectureCard {
  return { ...(row as unknown as LectureCard), hasNotes: Boolean(row.hasNotes) };
}

export async function listLectures(
  db: Db,
  userId: string,
  opts: { subjectId?: string | null; statuses?: SessionStatus[]; limit?: number; before?: number } = {},
): Promise<LectureCard[]> {
  const where: SQL[] = [eq(lectureSessions.userId, userId)];
  if (opts.subjectId) where.push(eq(lectureSessions.subjectId, opts.subjectId));
  if (opts.statuses?.length) where.push(inArray(lectureSessions.status, opts.statuses));
  if (opts.before) where.push(lt(lectureSessions.createdAt, opts.before));
  const rows = await db
    .select(cardColumns(userId))
    .from(lectureSessions)
    .leftJoin(subjects, and(eq(subjects.id, lectureSessions.subjectId), eq(subjects.userId, userId)))
    .where(and(...where))
    .orderBy(desc(lectureSessions.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200));
  return rows.map(toCard);
}

export async function getLectureRow(db: Db, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(lectureSessions)
    .where(and(eq(lectureSessions.id, id), eq(lectureSessions.userId, userId)))
    .limit(1);
  if (!row) throw notFound("Clase");
  return row;
}

export async function getLectureCard(db: Db, userId: string, id: string): Promise<LectureCard> {
  const [row] = await db
    .select(cardColumns(userId))
    .from(lectureSessions)
    .leftJoin(subjects, and(eq(subjects.id, lectureSessions.subjectId), eq(subjects.userId, userId)))
    .where(and(eq(lectureSessions.id, id), eq(lectureSessions.userId, userId)))
    .limit(1);
  if (!row) throw notFound("Clase");
  return toCard(row);
}

async function assertSubjectOwned(db: Db, userId: string, subjectId: string | null | undefined) {
  if (!subjectId) return;
  const [s] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(and(eq(subjects.id, subjectId), eq(subjects.userId, userId)))
    .limit(1);
  if (!s) throw notFound("Asignatura");
}

export async function createLecture(
  db: Db,
  userId: string,
  input: { title: string; subjectId?: string | null; keywords?: string[] },
) {
  await assertSubjectOwned(db, userId, input.subjectId);
  const id = newId();
  const now = Date.now();
  await db.insert(lectureSessions).values({
    id,
    userId,
    subjectId: input.subjectId ?? null,
    title: input.title.trim(),
    status: "created",
    processingStatus: "idle",
    durationMs: 0,
    keywords: input.keywords ?? [],
    languages: [],
    createdAt: now,
    updatedAt: now,
  });
  return getLectureCard(db, userId, id);
}

export async function updateLecture(
  db: Db,
  userId: string,
  id: string,
  input: { title?: string; subjectId?: string | null },
) {
  await getLectureRow(db, userId, id);
  if (input.subjectId !== undefined) await assertSubjectOwned(db, userId, input.subjectId);
  await db
    .update(lectureSessions)
    .set({
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.subjectId !== undefined ? { subjectId: input.subjectId } : {}),
      updatedAt: Date.now(),
    })
    .where(and(eq(lectureSessions.id, id), eq(lectureSessions.userId, userId)));
  return getLectureCard(db, userId, id);
}

/**
 * Move a lecture to another capture status. The database trigger enforces
 * the same transition table, so concurrent writers cannot create
 * contradictory states either.
 */
export async function transitionLecture(
  db: Db,
  userId: string,
  id: string,
  to: SessionStatus,
  extra: {
    durationMs?: number;
    failureReason?: string | null;
    transcriptionMode?: "realtime" | "turns";
    audioMime?: string;
  } = {},
) {
  const row = await getLectureRow(db, userId, id);
  if (!canTransition(row.status, to)) {
    throw conflict(`No se puede pasar de "${row.status}" a "${to}".`, "invalid_status_transition");
  }
  const now = Date.now();
  await db
    .update(lectureSessions)
    .set({
      status: to,
      ...(to === "recording" && !row.startedAt ? { startedAt: now } : {}),
      ...(to === "recording" || to === "paused" ? { lastHeartbeatAt: now } : {}),
      ...(to === "ready" ? { endedAt: row.endedAt ?? now } : {}),
      ...(extra.durationMs !== undefined ? { durationMs: Math.max(row.durationMs, Math.round(extra.durationMs)) } : {}),
      ...(extra.failureReason !== undefined ? { failureReason: extra.failureReason } : {}),
      ...(extra.transcriptionMode ? { transcriptionMode: extra.transcriptionMode } : {}),
      ...(extra.audioMime ? { audioMime: extra.audioMime } : {}),
      updatedAt: now,
    })
    .where(and(eq(lectureSessions.id, id), eq(lectureSessions.userId, userId)));
  return getLectureRow(db, userId, id);
}

export async function heartbeat(db: Db, userId: string, id: string, durationMs: number) {
  const now = Date.now();
  await db
    .update(lectureSessions)
    .set({
      lastHeartbeatAt: now,
      durationMs: sql`max(${lectureSessions.durationMs}, ${Math.round(durationMs)})`,
      updatedAt: now,
    })
    .where(
      and(
        eq(lectureSessions.id, id),
        eq(lectureSessions.userId, userId),
        inArray(lectureSessions.status, ["recording", "paused", "recovering"]),
      ),
    );
}

export async function deleteLecture(db: Db, bucket: R2Bucket, userId: string, id: string) {
  await getLectureRow(db, userId, id);
  // Files first: if this fails the row still exists and the user can retry.
  await deletePrefix(bucket, sessionPrefix(userId, id));
  await db.delete(lectureSessions).where(and(eq(lectureSessions.id, id), eq(lectureSessions.userId, userId)));
}

// ---------------------------------------------------------------------------
// Transcript segments
// ---------------------------------------------------------------------------

export interface SegmentInput {
  seq: number;
  text: string;
  status: "final" | "failed" | "gap";
  source: SegmentSource;
  startMs: number;
  endMs: number;
  providerItemId?: string | null;
  language: SegmentLanguage;
  languageSource: "heuristic" | "model";
}

/** Idempotent upsert keyed by (session_id, seq). */
export async function upsertSegments(db: Db, userId: string, sessionId: string, segments: SegmentInput[]) {
  if (!segments.length) return;
  const now = Date.now();
  const rows = segments.map((s) => ({
    id: newId(),
    userId,
    sessionId,
    seq: s.seq,
    providerItemId: s.providerItemId ?? null,
    text: s.text,
    status: s.status,
    source: s.source,
    startMs: Math.max(0, Math.round(s.startMs)),
    endMs: Math.max(Math.round(s.startMs), Math.round(s.endMs)),
    language: s.language,
    languageSource: s.languageSource,
    createdAt: now,
    updatedAt: now,
  }));
  const statements = chunkForInsert(rows, 14).map((batch) =>
    db
      .insert(transcriptSegments)
      .values(batch)
      .onConflictDoUpdate({
        target: [transcriptSegments.sessionId, transcriptSegments.seq],
        set: {
          text: sql`excluded.text`,
          status: sql`excluded.status`,
          source: sql`excluded.source`,
          startMs: sql`excluded.start_ms`,
          endMs: sql`excluded.end_ms`,
          providerItemId: sql`excluded.provider_item_id`,
          language: sql`excluded.language`,
          languageSource: sql`excluded.language_source`,
          updatedAt: now,
        },
        // A gap placeholder never overwrites a real transcript.
        setWhere: sql`NOT (excluded.status = 'gap' AND ${transcriptSegments.status} = 'final')`,
      }),
  );
  await db.batch(statements as [(typeof statements)[number], ...typeof statements]);
  await refreshLectureLanguages(db, userId, sessionId);
}

export async function refreshLectureLanguages(db: Db, userId: string, sessionId: string) {
  const rows = await db
    .select({ language: transcriptSegments.language, n: sql<number>`count(*)` })
    .from(transcriptSegments)
    .where(and(eq(transcriptSegments.sessionId, sessionId), eq(transcriptSegments.userId, userId)))
    .groupBy(transcriptSegments.language);
  await db
    .update(lectureSessions)
    .set({ languages: lectureLanguages(rows.map((r) => ({ language: r.language, count: r.n }))) })
    .where(and(eq(lectureSessions.id, sessionId), eq(lectureSessions.userId, userId)));
}

export async function listSegments(db: Db, userId: string, sessionId: string) {
  return db
    .select({
      seq: transcriptSegments.seq,
      text: transcriptSegments.text,
      status: transcriptSegments.status,
      source: transcriptSegments.source,
      startMs: transcriptSegments.startMs,
      endMs: transcriptSegments.endMs,
      language: transcriptSegments.language,
      languageSource: transcriptSegments.languageSource,
    })
    .from(transcriptSegments)
    .where(and(eq(transcriptSegments.sessionId, sessionId), eq(transcriptSegments.userId, userId)))
    .orderBy(asc(transcriptSegments.startMs), asc(transcriptSegments.seq));
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

export async function upsertMarker(
  db: Db,
  userId: string,
  sessionId: string,
  m: { id: string; type: MarkerType; atMs: number; note?: string | null },
) {
  await db
    .insert(lectureMarkers)
    .values({
      id: m.id,
      userId,
      sessionId,
      type: m.type,
      atMs: Math.max(0, Math.round(m.atMs)),
      note: m.note?.trim() || null,
      createdAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: lectureMarkers.id,
      set: { type: m.type, atMs: Math.max(0, Math.round(m.atMs)), note: m.note?.trim() || null },
      // Never let a marker id from another user be overwritten.
      setWhere: and(eq(lectureMarkers.userId, userId), eq(lectureMarkers.sessionId, sessionId)),
    });
}

export async function listMarkers(db: Db, userId: string, sessionId: string) {
  return db
    .select({
      id: lectureMarkers.id,
      type: lectureMarkers.type,
      atMs: lectureMarkers.atMs,
      note: lectureMarkers.note,
      createdAt: lectureMarkers.createdAt,
    })
    .from(lectureMarkers)
    .where(and(eq(lectureMarkers.sessionId, sessionId), eq(lectureMarkers.userId, userId)))
    .orderBy(asc(lectureMarkers.atMs));
}

export async function deleteMarker(db: Db, userId: string, sessionId: string, markerId: string) {
  await db
    .delete(lectureMarkers)
    .where(
      and(eq(lectureMarkers.id, markerId), eq(lectureMarkers.sessionId, sessionId), eq(lectureMarkers.userId, userId)),
    );
}

// ---------------------------------------------------------------------------
// Audio chunks
// ---------------------------------------------------------------------------

export async function listChunks(db: Db, userId: string, sessionId: string) {
  return db
    .select({
      id: audioChunks.id,
      seq: audioChunks.seq,
      startMs: audioChunks.startMs,
      endMs: audioChunks.endMs,
      durationMs: audioChunks.durationMs,
      overlapMs: audioChunks.overlapMs,
      mimeType: audioChunks.mimeType,
      sizeBytes: audioChunks.sizeBytes,
      sha256: audioChunks.sha256,
      partial: audioChunks.partial,
    })
    .from(audioChunks)
    .where(and(eq(audioChunks.sessionId, sessionId), eq(audioChunks.userId, userId)))
    .orderBy(asc(audioChunks.seq));
}

export async function getChunk(db: Db, userId: string, sessionId: string, seq: number) {
  const [row] = await db
    .select()
    .from(audioChunks)
    .where(and(eq(audioChunks.sessionId, sessionId), eq(audioChunks.userId, userId), eq(audioChunks.seq, seq)))
    .limit(1);
  if (!row) throw notFound("Fragmento de audio");
  return row;
}

/** Sequence numbers in [0, expected) that the server has not received. */
export function missingSequences(present: readonly number[], expected: number): number[] {
  const have = new Set(present);
  const missing: number[] = [];
  for (let i = 0; i < expected; i++) if (!have.has(i)) missing.push(i);
  return missing;
}
