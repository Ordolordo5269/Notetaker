import { authedRoute } from "@/lib/api/route";
import { examProgress } from "@/lib/data/exam";

export const GET = authedRoute(async ({ db, user, req }) => ({
  progress: await examProgress(db, user.id, req.nextUrl.searchParams.get("subjectId")),
}));
