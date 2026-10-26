import { authedRoute } from "@/lib/api/route";
import { getLectureRow } from "@/lib/data/lectures";
import { listFlashcards } from "@/lib/data/flashcards";

export const GET = authedRoute<{ id: string }>(async ({ db, user, params }) => {
  await getLectureRow(db, user.id, params.id);
  return { cards: await listFlashcards(db, user.id, { sessionId: params.id }) };
});
