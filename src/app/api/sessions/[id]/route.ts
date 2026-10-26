import { z } from "zod";
import { authedRoute, readJson } from "@/lib/api/route";
import { deleteLecture, getLectureCard, getLectureRow, updateLecture } from "@/lib/data/lectures";

const Patch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  subjectId: z.string().uuid().nullable().optional(),
});

export const GET = authedRoute<{ id: string }>(async ({ db, user, params }) => {
  const [card, row] = await Promise.all([
    getLectureCard(db, user.id, params.id),
    getLectureRow(db, user.id, params.id),
  ]);
  return {
    lecture: {
      ...card,
      endedAt: row.endedAt,
      keywords: row.keywords,
      failureReason: row.failureReason,
      audioMime: row.audioMime,
    },
  };
});

export const PATCH = authedRoute<{ id: string }>(async ({ db, user, params, req }) => ({
  lecture: await updateLecture(db, user.id, params.id, await readJson(req, Patch)),
}));

export const DELETE = authedRoute<{ id: string }>(async ({ db, env, user, params }) => {
  await deleteLecture(db, env.FILES, user.id, params.id);
});
