// Daily maintenance run by the Worker cron trigger.
import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { audioChunks, lectureSessions, processingJobs, profiles } from "@/lib/db/schema";
import { purgeExpiredSessions } from "@/lib/auth/sessions";

export async function runMaintenance(env: CloudflareEnv): Promise<void> {
  const db = getDb(env.DB);
  const now = Date.now();

  await purgeExpiredSessions(db);

  // Jobs that stopped reporting progress (worker lost) are marked failed so
  // the user can retry instead of waiting forever.
  await db
    .update(processingJobs)
    .set({
      status: "failed",
      error: "El trabajo dejó de responder y se marcó como fallido.",
      finishedAt: now,
      updatedAt: now,
    })
    .where(and(eq(processingJobs.status, "running"), lt(processingJobs.heartbeatAt, now - 30 * 60 * 1000)));
  await db
    .update(lectureSessions)
    .set({ processingStatus: "failed", updatedAt: now })
    .where(
      and(
        inArray(lectureSessions.processingStatus, ["queued", "processing"]),
        sql`NOT EXISTS (SELECT 1 FROM processing_jobs j WHERE j.session_id = ${lectureSessions.id} AND j.status IN ('queued','running'))`,
      ),
    );

  // Audio retention: delete audio files (never transcripts or notes) older
  // than the per-user retention period.
  const users = await db
    .select({ userId: profiles.userId, days: profiles.audioRetentionDays })
    .from(profiles)
    .where(isNotNull(profiles.audioRetentionDays));
  for (const u of users) {
    if (!u.days) continue;
    const cutoff = now - u.days * 86_400_000;
    const old = await db
      .select({ id: audioChunks.id, key: audioChunks.r2Key })
      .from(audioChunks)
      .innerJoin(lectureSessions, eq(lectureSessions.id, audioChunks.sessionId))
      .where(
        and(eq(audioChunks.userId, u.userId), eq(lectureSessions.status, "ready"), lt(lectureSessions.endedAt, cutoff)),
      )
      .limit(500);
    if (!old.length) continue;
    await env.FILES.delete(old.map((o) => o.key));
    await db.delete(audioChunks).where(
      inArray(
        audioChunks.id,
        old.map((o) => o.id),
      ),
    );
  }
}
