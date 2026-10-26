import { authedRoute } from "@/lib/api/route";
import { getLectureRow } from "@/lib/data/lectures";
import { listDocuments } from "@/lib/data/documents";

export const GET = authedRoute<{ id: string }>(async ({ db, user, params }) => {
  await getLectureRow(db, user.id, params.id);
  return { documents: await listDocuments(db, user.id, params.id) };
});
