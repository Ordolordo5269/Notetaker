import { authedRoute } from "@/lib/api/route";
import { getDocument, getVersion } from "@/lib/data/documents";
import { notFound } from "@/lib/errors";

export const GET = authedRoute<{ documentId: string; versionId: string }>(async ({ db, user, params }) => {
  const doc = await getDocument(db, user.id, params.documentId);
  const version = await getVersion(db, user.id, params.versionId);
  if (version.documentId !== doc.id) throw notFound("Versión");
  return { version };
});
