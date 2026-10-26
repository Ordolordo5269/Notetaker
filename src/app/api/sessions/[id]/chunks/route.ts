import { authedRoute } from "@/lib/api/route";
import { getLectureRow, listChunks } from "@/lib/data/lectures";

export const GET = authedRoute<{ id: string }>(async ({ db, user, params }) => {
  await getLectureRow(db, user.id, params.id);
  return { chunks: await listChunks(db, user.id, params.id) };
});
