import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { audioChunks } from "@/lib/db/schema";

/** Seconds of stored audio a transcription job would send to the model (overlaps excluded). */
export async function storedAudioSeconds(
  db: Db,
  userId: string,
  sessionId: string,
): Promise<{ seconds: number; chunks: number }> {
  const rows = await db
    .select({ durationMs: audioChunks.durationMs, overlapMs: audioChunks.overlapMs })
    .from(audioChunks)
    .where(and(eq(audioChunks.sessionId, sessionId), eq(audioChunks.userId, userId)));
  const ms = rows.reduce((n, r) => n + Math.max(0, r.durationMs - r.overlapMs), 0);
  return { seconds: ms / 1000, chunks: rows.length };
}
