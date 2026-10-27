// Transcribes the stored audio chunks of a lecture with the file model.
// Used for imported audio files (the browser cut the file into chunks and
// uploaded them); each chunk becomes one transcript segment with the chunk's
// time span, so the player, the references and the notes work exactly as for
// a live recording. Runs as the "recovery_transcription" job: one resumable
// step per chunk, bounded concurrency, usage recorded per chunk.
import { and, asc, eq } from "drizzle-orm";
import { audioChunks, transcriptSegments } from "@/lib/db/schema";
import { getTranscriptionContext } from "@/lib/data/context";
import { upsertSegments } from "@/lib/data/lectures";
import { assertBudget } from "@/lib/cost/usage";
import { enqueueJob } from "@/lib/jobs/queue";
import { registerJobHandler } from "@/lib/jobs/handlers";
import type { JobContext } from "@/lib/jobs/runner";
import { dedupeKeyFor, estimateJob, paramsFor, withProfileDefaults, type JobRequest } from "@/lib/jobs/requests";
import { safetyIdentifier, transcribeFile } from "@/lib/openai/client";
import {
  buildTranscriptionPrompt,
  sanitizeKeywords,
  TRANSCRIPTION_LANGUAGES,
} from "@/lib/transcription/session-config";
import { resolveSegmentLanguage } from "@/lib/transcription/language";
import { extensionForMime } from "@/lib/import/plan";
import type { DocumentLanguage } from "@/lib/db/schema";

export interface ImportTranscriptionParams {
  /** Launch the full notes job when the transcript is complete. */
  thenNotes?: boolean;
  language?: DocumentLanguage | "auto";
}

const CONCURRENCY = 3;
export const IMPORT_STAGES = {
  prepare: "Preparando la transcripción",
  transcribe: "Transcribiendo el audio",
  notes: "Encolando los apuntes",
  done: "Transcripción completa",
} as const;

async function importTranscriptionHandler(ctx: JobContext): Promise<Record<string, unknown>> {
  const sessionId = ctx.job.sessionId;
  if (!sessionId) ctx.fail("El trabajo no tiene clase asociada.");
  const params = (ctx.job.params ?? {}) as ImportTranscriptionParams;
  const { db, config, env } = ctx;
  const userId = ctx.job.userId;

  await ctx.setStage(IMPORT_STAGES.prepare);
  const chunks = await db
    .select({
      seq: audioChunks.seq,
      startMs: audioChunks.startMs,
      endMs: audioChunks.endMs,
      durationMs: audioChunks.durationMs,
      mimeType: audioChunks.mimeType,
      r2Key: audioChunks.r2Key,
      sizeBytes: audioChunks.sizeBytes,
    })
    .from(audioChunks)
    .where(and(eq(audioChunks.sessionId, sessionId), eq(audioChunks.userId, userId)))
    .orderBy(asc(audioChunks.seq));
  if (!chunks.length) ctx.fail("La clase no tiene audio almacenado que transcribir.");

  const existing = await db
    .select({ seq: transcriptSegments.seq, source: transcriptSegments.source, status: transcriptSegments.status })
    .from(transcriptSegments)
    .where(and(eq(transcriptSegments.sessionId, sessionId), eq(transcriptSegments.userId, userId)));
  // A live recording keeps its own turn numbering: new segments go after it.
  const liveMax = existing
    .filter((s) => s.source === "realtime" || s.source === "turns")
    .reduce((m, s) => Math.max(m, s.seq), -1);
  const base = liveMax + 1;
  const done = new Set(existing.filter((s) => s.status === "final").map((s) => s.seq));
  const pending = chunks.filter((c) => !done.has(base + c.seq));

  const tctx = await getTranscriptionContext(db, userId, sessionId);
  const prompt = buildTranscriptionPrompt(tctx);
  const keywords = sanitizeKeywords(tctx.keywords);
  const safetyId = await safetyIdentifier(userId);

  let finished = chunks.length - pending.length;
  await ctx.setStage(`${IMPORT_STAGES.transcribe} (${finished}/${chunks.length})`);
  let stageChain: Promise<void> = Promise.resolve();
  const reportStage = (stage: string) => {
    stageChain = stageChain.then(() => ctx.setStage(stage)).catch(() => undefined);
    return stageChain;
  };

  let silent = 0;
  let characters = 0;
  const queue = [...pending];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const chunk = queue.shift()!;
      const result = await ctx.step(`transcribe:${chunk.seq}`, async () => {
        const object = await env.FILES.get(chunk.r2Key);
        if (!object) throw new Error(`Falta el audio del fragmento ${chunk.seq} en el almacenamiento.`);
        const mime = chunk.mimeType.split(";")[0]!;
        const blob = new Blob([await object.arrayBuffer()], { type: mime });
        const t = await transcribeFile(config, blob, `chunk-${chunk.seq}.${extensionForMime(mime)}`, {
          prompt,
          keywords,
          languages: TRANSCRIPTION_LANGUAGES,
          safetyId,
        });
        await ctx.usage({
          kind: "file_transcription",
          model: config.models.file,
          audioSeconds: t.audioSeconds || Math.max(1, chunk.durationMs / 1000),
        });
        if (!t.text) return { chars: 0 };
        const lang = resolveSegmentLanguage(t.text, t.languages);
        await upsertSegments(db, userId, sessionId, [
          {
            seq: base + chunk.seq,
            text: t.text,
            status: "final",
            source: "recovery",
            startMs: chunk.startMs,
            endMs: chunk.endMs,
            providerItemId: null,
            language: lang.language,
            languageSource: lang.source,
          },
        ]);
        return { chars: t.text.length };
      });
      if (result.chars === 0) silent++;
      characters += result.chars;
      finished++;
      await reportStage(`${IMPORT_STAGES.transcribe} (${finished}/${chunks.length})`);
    }
  });
  await Promise.all(workers);

  let notesJobId: string | null = null;
  let notesSkipped: string | null = null;
  if (params.thenNotes) {
    await ctx.setStage(IMPORT_STAGES.notes);
    const outcome = await ctx.step("enqueue-notes", async () => {
      const req = await withProfileDefaults(db, userId, {
        type: "notes",
        language: params.language ?? "auto",
        includeAttachments: true,
      } as JobRequest);
      try {
        const estimate = await estimateJob(db, config, userId, sessionId, req);
        await assertBudget(db, userId, estimate.usd, { isJob: true });
        const { job } = await enqueueJob(env, db, {
          userId,
          sessionId,
          jobType: "notes",
          dedupeKey: dedupeKeyFor(sessionId, req),
          params: paramsFor(req),
          estimatedCostUsd: estimate.usd,
        });
        return { jobId: job.id, skipped: null as string | null };
      } catch (err) {
        // Not enough transcript, or over budget: the transcript itself is still a success.
        return { jobId: null, skipped: err instanceof Error ? err.message : String(err) };
      }
    });
    notesJobId = outcome.jobId;
    notesSkipped = outcome.skipped;
  }

  await ctx.setStage(IMPORT_STAGES.done);
  return {
    chunks: chunks.length,
    transcribed: chunks.length - silent,
    silent,
    characters,
    notesJobId,
    notesSkipped,
  };
}

registerJobHandler("recovery_transcription", importTranscriptionHandler);
