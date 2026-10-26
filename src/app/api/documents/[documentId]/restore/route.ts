import { z } from "zod";
import { authedRoute, readJson } from "@/lib/api/route";
import { getDocument, getVersion, replaceNotesSources, saveDocumentVersion } from "@/lib/data/documents";
import { notFound } from "@/lib/errors";

const bodySchema = z.object({ versionId: z.string().min(1) });

/** Make an earlier version current again, as a new version (history is never rewritten). */
export const POST = authedRoute<{ documentId: string }>(async ({ db, user, params, req }) => {
  const { versionId } = await readJson(req, bodySchema);
  const doc = await getDocument(db, user.id, params.documentId);
  const version = await getVersion(db, user.id, versionId);
  if (version.documentId !== doc.id) throw notFound("Versión");
  if (doc.currentVersionId === version.id) {
    return { documentId: doc.id, versionId: version.id, versionNumber: version.versionNumber, unchanged: true };
  }
  const saved = await saveDocumentVersion(db, {
    userId: user.id,
    sessionId: doc.sessionId,
    kind: doc.kind,
    content: version.content,
    origin: "restore",
    label: `Restaurada la versión ${version.versionNumber}`,
  });
  if (doc.kind === "notes") await replaceNotesSources(db, user.id, doc.sessionId, version.content);
  return { ...saved, unchanged: false };
});
