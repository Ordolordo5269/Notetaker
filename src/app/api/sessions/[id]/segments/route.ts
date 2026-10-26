import { z } from "zod";
import { authedRoute, readJson } from "@/lib/api/route";
import { getLectureRow, listSegments, upsertSegments } from "@/lib/data/lectures";
import { SEGMENT_LANGUAGES, SEGMENT_SOURCES } from "@/lib/db/schema";
import { recordUsage } from "@/lib/cost/usage";

const Segment = z.object({
  seq: z.number().int().min(0).max(1e9),
  text: z.string().max(20_000),
  status: z.enum(["final", "failed", "gap"]),
  source: z.enum(SEGMENT_SOURCES),
  startMs: z.number().min(0),
  endMs: z.number().min(0),
  providerItemId: z.string().max(200).nullish(),
  language: z.enum(SEGMENT_LANGUAGES),
  languageSource: z.enum(["heuristic", "model"]),
});

const Body = z.object({
  segments: z.array(Segment).max(500),
  // Live transcription audio confirmed by the provider since the last batch.
  liveAudioSeconds: z
    .number()
    .min(0)
    .max(4 * 3600)
    .optional(),
  liveModel: z.string().max(80).optional(),
});

export const GET = authedRoute<{ id: string }>(async ({ db, user, params }) => {
  await getLectureRow(db, user.id, params.id);
  return { segments: await listSegments(db, user.id, params.id) };
});

export const POST = authedRoute<{ id: string }>(async ({ db, user, params, req, config }) => {
  const body = await readJson(req, Body, 2 * 1024 * 1024);
  await getLectureRow(db, user.id, params.id);
  await upsertSegments(db, user.id, params.id, body.segments);
  if (body.liveAudioSeconds && body.liveAudioSeconds > 0) {
    await recordUsage(db, {
      userId: user.id,
      sessionId: params.id,
      kind: "live_transcription",
      model: body.liveModel ?? config.models.live,
      audioSeconds: body.liveAudioSeconds,
    });
  }
  return { ok: true, saved: body.segments.map((s) => s.seq) };
});
