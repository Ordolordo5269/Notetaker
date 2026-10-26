import { z } from "zod";
import { authedRoute, readJson } from "@/lib/api/route";
import {
  getCurrentContent,
  getDocument,
  loadSourceSegments,
  replaceNotesSources,
  saveDocumentVersion,
} from "@/lib/data/documents";
import { notFound } from "@/lib/errors";
import { normalizeRefs } from "@/lib/notes/transcript";
import { countWords, type TranscriptRef } from "@/lib/notes/types";

const bodySchema = z.object({
  markdown: z.string().max(200_000),
  heading: z.string().trim().min(1).max(300).optional(),
});

/** Union of the section's original spans and any the user cited; sorted by time. */
function mergeRefs(a: TranscriptRef[], b: TranscriptRef[]): TranscriptRef[] {
  const byKey = new Map<string, TranscriptRef>();
  for (const r of [...a, ...b]) byKey.set(`${r.seqFrom}-${r.seqTo}`, r);
  return [...byKey.values()].sort((x, y) => x.startMs - y.startMs);
}

/** Save a manual edit of one section as a new document version (origin "user"). */
export const PATCH = authedRoute<{ documentId: string; sectionId: string }>(async ({ db, user, params, req }) => {
  const body = await readJson(req, bodySchema, 1024 * 1024);
  const doc = await getDocument(db, user.id, params.documentId);
  const current = await getCurrentContent(db, user.id, doc.sessionId, doc.kind);
  if (!current) throw notFound("Documento");
  const idx = current.content.sections.findIndex((s) => s.id === params.sectionId);
  if (idx < 0) throw notFound("Sección");
  const prev = current.content.sections[idx]!;
  const segments = await loadSourceSegments(db, user.id, doc.sessionId);
  const { markdown, refs } = normalizeRefs(body.markdown, segments);
  const sections = current.content.sections.map((s, i) =>
    i === idx
      ? { ...s, heading: body.heading ?? s.heading, markdown, refs: mergeRefs(prev.refs, refs), edited: true }
      : s,
  );
  const content = {
    ...current.content,
    sections,
    meta: { ...current.content.meta, wordCount: sections.reduce((n, s) => n + countWords(s.markdown), 0) },
  };
  const saved = await saveDocumentVersion(db, {
    userId: user.id,
    sessionId: doc.sessionId,
    kind: doc.kind,
    content,
    origin: "user",
    label: `Edición manual: ${sections[idx]!.heading}`,
  });
  if (doc.kind === "notes") await replaceNotesSources(db, user.id, doc.sessionId, content);
  return { ...saved, section: sections[idx] };
});
