import { authedRoute } from "@/lib/api/route";
import { deleteMarker, getLectureRow } from "@/lib/data/lectures";

export const DELETE = authedRoute<{ id: string; markerId: string }>(async ({ db, user, params }) => {
  await getLectureRow(db, user.id, params.id);
  await deleteMarker(db, user.id, params.id, params.markerId);
});
