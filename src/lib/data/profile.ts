import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";

import type { NotesQuality } from "@/lib/notes/estimate";

export type TranscriptionMode = "realtime" | "turns";
export type { NotesQuality };

export async function getProfile(db: Db, userId: string) {
  const [p] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (p) return p;
  // Accounts created before profiles existed: create defaults lazily.
  const now = Date.now();
  const row = {
    userId,
    notesLanguage: "auto" as const,
    removeFillers: true,
    transcriptionDelay: "medium" as const,
    transcriptionMode: "realtime" as const,
    notesQuality: "max" as const,
    audioReviewEnabled: false,
    audioRetentionDays: null,
    monthlyBudgetUsd: null,
    jobBudgetUsd: null,
    recordingNoticeAckAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(profiles).values(row).onConflictDoNothing();
  return row;
}

export type ProfilePatch = Partial<{
  notesLanguage: "auto" | "es" | "en" | "bilingual";
  removeFillers: boolean;
  transcriptionDelay: "minimal" | "low" | "medium" | "high" | "xhigh";
  transcriptionMode: TranscriptionMode;
  notesQuality: NotesQuality;
  audioReviewEnabled: boolean;
  audioRetentionDays: number | null;
  monthlyBudgetUsd: number | null;
  jobBudgetUsd: number | null;
  acknowledgeRecordingNotice: boolean;
}>;

export async function updateProfile(db: Db, userId: string, patch: ProfilePatch) {
  await getProfile(db, userId);
  const { acknowledgeRecordingNotice, ...rest } = patch;
  await db
    .update(profiles)
    .set({
      ...rest,
      ...(acknowledgeRecordingNotice ? { recordingNoticeAckAt: Date.now() } : {}),
      updatedAt: Date.now(),
    })
    .where(eq(profiles.userId, userId));
  return getProfile(db, userId);
}
