import { authedRoute } from "@/lib/api/route";
import { getLectureRow } from "@/lib/data/lectures";
import { listQuestions } from "@/lib/data/documents";

export const GET = authedRoute<{ id: string }>(async ({ db, user, params }) => {
  await getLectureRow(db, user.id, params.id);
  return { questions: await listQuestions(db, user.id, params.id) };
});
