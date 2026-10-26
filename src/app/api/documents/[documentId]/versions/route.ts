import { authedRoute } from "@/lib/api/route";
import { listVersions } from "@/lib/data/documents";

export const GET = authedRoute<{ documentId: string }>(async ({ db, user, params }) => ({
  versions: await listVersions(db, user.id, params.documentId),
}));
