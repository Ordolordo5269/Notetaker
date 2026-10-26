import { z } from "zod";
import { authedRoute, readJson } from "@/lib/api/route";
import { getLectureRow, heartbeat } from "@/lib/data/lectures";

const Body = z.object({
  durationMs: z
    .number()
    .min(0)
    .max(24 * 3600 * 1000),
});

export const POST = authedRoute<{ id: string }>(async ({ db, user, params, req }) => {
  const body = await readJson(req, Body);
  await getLectureRow(db, user.id, params.id);
  await heartbeat(db, user.id, params.id, body.durationMs);
  return { ok: true, serverTime: Date.now() };
});
