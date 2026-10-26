import { z } from "zod";
import { authedRoute, readJson } from "@/lib/api/route";
import { deleteFlashcard, updateFlashcard } from "@/lib/data/flashcards";

const Patch = z.object({
  suspended: z.boolean().optional(),
  front: z.string().trim().min(1).max(2000).optional(),
  back: z.string().trim().min(1).max(6000).optional(),
});

export const PATCH = authedRoute<{ cardId: string }>(async ({ db, user, params, req }) => {
  await updateFlashcard(db, user.id, params.cardId, await readJson(req, Patch));
  return { ok: true };
});

export const DELETE = authedRoute<{ cardId: string }>(async ({ db, user, params }) => {
  await deleteFlashcard(db, user.id, params.cardId);
});
