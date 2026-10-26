import { authedRoute } from "@/lib/api/route";
import { getLectureRow } from "@/lib/data/lectures";
import { pickNextQuestion } from "@/lib/data/exam";
import { QUESTION_TYPES, type QuestionType } from "@/lib/db/schema";

export const GET = authedRoute<{ id: string }>(async ({ db, user, params, req }) => {
  await getLectureRow(db, user.id, params.id);
  const sp = req.nextUrl.searchParams;
  const types = sp.getAll("type").filter((t): t is QuestionType => (QUESTION_TYPES as readonly string[]).includes(t));
  const exclude = sp.getAll("exclude").slice(0, 200);
  return { next: await pickNextQuestion(db, user.id, params.id, { types, exclude }) };
});
