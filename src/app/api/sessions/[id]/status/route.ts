import { z } from "zod";
import { authedRoute, readJson } from "@/lib/api/route";
import { getLectureRow, listChunks, missingFrom, missingSequences, transitionLecture } from "@/lib/data/lectures";
import { conflict } from "@/lib/errors";

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    transcriptionMode: z.enum(["realtime", "turns"]).optional(),
    audioMime: z.string().max(100).optional(),
  }),
  z.object({ action: z.literal("pause"), durationMs: z.number().min(0) }),
  z.object({ action: z.literal("resume"), durationMs: z.number().min(0).optional() }),
  z.object({ action: z.literal("recover") }),
  z.object({ action: z.literal("mode"), transcriptionMode: z.enum(["realtime", "turns"]) }),
  z.object({
    action: z.literal("finalize"),
    durationMs: z.number().min(0),
    // Number of audio chunks the client produced (seq 0..n-1); legacy clients only.
    expectedChunks: z.number().int().min(0).max(100_000),
    // Exact sequences the client holds audio for. A recorder torn down before its first
    // 5-second part (tab closed at once) leaves a sequence number with no data: it is
    // not expected, and the recovery already noted the gap in the transcript.
    expectedSequences: z.array(z.number().int().min(0).max(100_000)).max(100_000).optional(),
    // Finish even if some chunks never reached the server (user confirmed).
    acceptMissing: z.boolean().default(false),
  }),
  z.object({ action: z.literal("fail"), reason: z.string().max(500) }),
]);

export const POST = authedRoute<{ id: string }>(async ({ db, user, params, req }) => {
  const body = await readJson(req, Body);
  const id = params.id;
  const current = await getLectureRow(db, user.id, id);
  switch (body.action) {
    case "start":
      return {
        lecture: await transitionLecture(db, user.id, id, "recording", {
          transcriptionMode: body.transcriptionMode,
          audioMime: body.audioMime,
        }),
      };
    case "pause":
      return { lecture: await transitionLecture(db, user.id, id, "paused", { durationMs: body.durationMs }) };
    case "resume":
      return { lecture: await transitionLecture(db, user.id, id, "recording", { durationMs: body.durationMs }) };
    case "recover":
      return { lecture: await transitionLecture(db, user.id, id, "recovering") };
    case "mode":
      return {
        lecture: await transitionLecture(db, user.id, id, current.status, {
          transcriptionMode: body.transcriptionMode,
        }),
      };
    case "fail":
      return { lecture: await transitionLecture(db, user.id, id, "failed", { failureReason: body.reason }) };
    case "finalize": {
      if (current.status !== "finalizing") {
        await transitionLecture(db, user.id, id, "finalizing", { durationMs: body.durationMs });
      }
      const chunks = await listChunks(db, user.id, id);
      const present = chunks.map((c) => c.seq);
      const missing = body.expectedSequences
        ? missingFrom(present, body.expectedSequences)
        : missingSequences(present, body.expectedChunks);
      if (missing.length && !body.acceptMissing) {
        // Stay in "finalizing": the client keeps uploading and retries.
        throw conflict(`Faltan ${missing.length} fragmentos de audio por sincronizar.`, "chunks_missing");
      }
      const lecture = await transitionLecture(db, user.id, id, "ready", {
        durationMs: body.durationMs,
        failureReason: missing.length ? `Fragmentos de audio no recibidos: ${missing.join(", ")}` : null,
      });
      return { lecture, missingChunks: missing };
    }
  }
});
