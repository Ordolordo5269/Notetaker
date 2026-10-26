import { authedRoute } from "@/lib/api/route";
import { listFlashcards, reviewSummary } from "@/lib/data/flashcards";

/** Review queue: due cards (optionally for one subject) plus per-subject counts. */
export const GET = authedRoute(async ({ db, user, req }) => {
  const sp = req.nextUrl.searchParams;
  const subjectId = sp.get("subjectId");
  const dueOnly = sp.get("due") !== "0";
  const [cards, summary] = await Promise.all([
    listFlashcards(db, user.id, { subjectId: subjectId || undefined, dueOnly, limit: Number(sp.get("limit") ?? 60) }),
    reviewSummary(db, user.id),
  ]);
  return { cards, summary };
});
