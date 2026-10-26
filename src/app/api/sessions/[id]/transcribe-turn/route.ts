import { and, eq } from "drizzle-orm";
import { authedRoute } from "@/lib/api/route";
import { getTranscriptionContext } from "@/lib/data/context";
import { upsertSegments } from "@/lib/data/lectures";
import { assertBudget, recordUsage } from "@/lib/cost/usage";
import { audioCost } from "@/lib/cost/pricing";
import { transcribeFile, safetyIdentifier } from "@/lib/openai/client";
import {
  buildTranscriptionPrompt,
  sanitizeKeywords,
  TRANSCRIPTION_LANGUAGES,
} from "@/lib/transcription/session-config";
import { resolveSegmentLanguage } from "@/lib/transcription/language";
import { transcriptSegments } from "@/lib/db/schema";
import { badRequest } from "@/lib/errors";

const MAX_BYTES = 8 * 1024 * 1024; // ~170 s of 24 kHz mono PCM16 WAV

/**
 * Transcribes one committed audio turn with gpt-transcribe (HTTP fallback
 * when the Realtime WebSocket is unavailable, and gap recovery). Writes the
 * segment directly so the result is durable even if the tab closes.
 */
export const POST = authedRoute<{ id: string }>(async ({ db, user, params, req, config }) => {
  const sessionId = params.id;
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BYTES + 64 * 1024) throw badRequest("Fragmento de audio demasiado grande");
  const form = await req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0 || audio.size > MAX_BYTES) throw badRequest("Audio no válido");
  const seq = Number(form.get("seq"));
  const startMs = Number(form.get("startMs"));
  const endMs = Number(form.get("endMs"));
  const source = form.get("source") === "recovery" ? "recovery" : "turns";
  if (!Number.isInteger(seq) || seq < 0 || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    throw badRequest("Metadatos del fragmento no válidos");
  }

  const ctx = await getTranscriptionContext(db, user.id, sessionId);
  const seconds = Math.max(1, (endMs - startMs) / 1000);
  await assertBudget(db, user.id, audioCost(config.models.file, seconds));

  const result = await transcribeFile(config, audio, `turn-${seq}.wav`, {
    prompt: buildTranscriptionPrompt(ctx),
    keywords: sanitizeKeywords(ctx.keywords),
    languages: TRANSCRIPTION_LANGUAGES,
    safetyId: await safetyIdentifier(user.id),
  });
  await recordUsage(db, {
    userId: user.id,
    sessionId,
    kind: "file_transcription",
    model: config.models.file,
    audioSeconds: result.audioSeconds || seconds,
  });

  if (!result.text) {
    // Silence: nothing to store. A recovered gap with no speech is resolved.
    if (source === "recovery") {
      await db
        .delete(transcriptSegments)
        .where(
          and(
            eq(transcriptSegments.sessionId, sessionId),
            eq(transcriptSegments.userId, user.id),
            eq(transcriptSegments.seq, seq),
            eq(transcriptSegments.status, "gap"),
          ),
        );
    }
    return { seq, text: "", language: "und", languageSource: "heuristic" };
  }

  const lang = resolveSegmentLanguage(result.text, result.languages);
  await upsertSegments(db, user.id, sessionId, [
    {
      seq,
      text: result.text,
      status: "final",
      source,
      startMs,
      endMs,
      providerItemId: null,
      language: lang.language,
      languageSource: lang.source,
    },
  ]);
  return { seq, text: result.text, language: lang.language, languageSource: lang.source };
});
