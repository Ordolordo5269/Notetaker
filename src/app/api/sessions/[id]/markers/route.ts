import { z } from "zod";
import { authedRoute, readJson } from "@/lib/api/route";
import { getLectureRow, listMarkers, upsertMarker } from "@/lib/data/lectures";
import { MARKER_TYPES } from "@/lib/db/schema";

const Marker = z.object({
  id: z.string().uuid(),
  type: z.enum(MARKER_TYPES),
  atMs: z.number().min(0),
  note: z.string().max(2000).nullish(),
});

export const GET = authedRoute<{ id: string }>(async ({ db, user, params }) => {
  await getLectureRow(db, user.id, params.id);
  return { markers: await listMarkers(db, user.id, params.id) };
});

export const POST = authedRoute<{ id: string }>(async ({ db, user, params, req }) => {
  const marker = await readJson(req, Marker);
  await getLectureRow(db, user.id, params.id);
  await upsertMarker(db, user.id, params.id, marker);
  return { ok: true, id: marker.id };
});
