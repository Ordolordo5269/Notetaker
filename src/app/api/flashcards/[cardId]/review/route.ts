import { z } from "zod";
import { authedRoute, readJson } from "@/lib/api/route";
import { gradeFlashcard } from "@/lib/data/flashcards";
import { REVIEW_GRADES } from "@/lib/db/schema";

const Body = z.object({ grade: z.enum(REVIEW_GRADES) });

export const POST = authedRoute<{ cardId: string }>(async ({ db, user, params, req }) => {
  const { grade } = await readJson(req, Body);
  return { next: await gradeFlashcard(db, user.id, params.cardId, grade) };
});
