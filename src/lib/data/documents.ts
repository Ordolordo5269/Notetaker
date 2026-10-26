import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { chunkForInsert } from "@/lib/db";
import {
  documentSources,
  examQuestions,
  lectureAttachments,
  studyDocumentVersions,
  studyDocuments,
  transcriptSegments,
  type DocumentKind,
  type DocumentLanguage,
  type SourceRef,
  type VersionOrigin,
} from "@/lib/db/schema";
import { notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import {
  documentPlainText,
  documentWordCount,
  studyDocumentContentSchema,
  type StudyDocumentContent,
} from "@/lib/notes/types";
import type { SourceSegment } from "@/lib/notes/transcript";

export async function loadSourceSegments(db: Db, userId: string, sessionId: string): Promise<SourceSegment[]> {
  return db
    .select({
      seq: transcriptSegments.seq,
      text: transcriptSegments.text,
      status: transcriptSegments.status,
      startMs: transcriptSegments.startMs,
      endMs: transcriptSegments.endMs,
      language: transcriptSegments.language,
    })
    .from(transcriptSegments)
    .where(and(eq(transcriptSegments.sessionId, sessionId), eq(transcriptSegments.userId, userId)))
    .orderBy(asc(transcriptSegments.startMs), asc(transcriptSegments.seq));
}

export interface AttachmentPage {
  attachmentId: string;
  fileName: string;
  page: number;
  text: string;
}

/** Extracted text of the lecture's attachments (empty until Phase 3 extraction ran). */
export async function loadAttachmentPages(db: Db, userId: string, sessionId: string): Promise<AttachmentPage[]> {
  const rows = await db
    .select({
      attachmentId: documentSources.attachmentId,
      page: documentSources.pageNumber,
      text: documentSources.text,
      fileName: lectureAttachments.fileName,
    })
    .from(documentSources)
    .innerJoin(lectureAttachments, eq(lectureAttachments.id, documentSources.attachmentId))
    .where(
      and(
        eq(documentSources.sessionId, sessionId),
        eq(documentSources.userId, userId),
        eq(documentSources.sourceType, "attachment"),
      ),
    )
    .orderBy(asc(lectureAttachments.createdAt), asc(documentSources.pageNumber));
  return rows
    .filter((r): r is typeof r & { attachmentId: string; page: number } => r.attachmentId !== null && r.page !== null)
    .map((r) => ({ attachmentId: r.attachmentId, fileName: r.fileName, page: r.page, text: r.text }));
}

export interface DocumentView {
  id: string;
  kind: DocumentKind;
  language: DocumentLanguage;
  title: string;
  currentVersionId: string | null;
  versionNumber: number | null;
  origin: VersionOrigin | null;
  content: StudyDocumentContent | null;
  updatedAt: number;
}

export async function listDocuments(db: Db, userId: string, sessionId: string): Promise<DocumentView[]> {
  const rows = await db
    .select({
      id: studyDocuments.id,
      kind: studyDocuments.kind,
      language: studyDocuments.language,
      title: studyDocuments.title,
      currentVersionId: studyDocuments.currentVersionId,
      updatedAt: studyDocuments.updatedAt,
      versionNumber: studyDocumentVersions.versionNumber,
      origin: studyDocumentVersions.origin,
      content: studyDocumentVersions.content,
    })
    .from(studyDocuments)
    .leftJoin(studyDocumentVersions, eq(studyDocumentVersions.id, studyDocuments.currentVersionId))
    .where(and(eq(studyDocuments.sessionId, sessionId), eq(studyDocuments.userId, userId)));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    language: r.language,
    title: r.title,
    currentVersionId: r.currentVersionId,
    versionNumber: r.versionNumber,
    origin: r.origin,
    content: r.content ? parseContent(r.content) : null,
    updatedAt: r.updatedAt,
  }));
}

export function parseContent(json: string): StudyDocumentContent | null {
  try {
    return studyDocumentContentSchema.parse(JSON.parse(json));
  } catch {
    return null;
  }
}

export async function getDocument(db: Db, userId: string, documentId: string) {
  const [row] = await db
    .select()
    .from(studyDocuments)
    .where(and(eq(studyDocuments.id, documentId), eq(studyDocuments.userId, userId)))
    .limit(1);
  if (!row) throw notFound("Documento");
  return row;
}

export async function getDocumentByKind(db: Db, userId: string, sessionId: string, kind: DocumentKind) {
  const [row] = await db
    .select()
    .from(studyDocuments)
    .where(
      and(eq(studyDocuments.sessionId, sessionId), eq(studyDocuments.userId, userId), eq(studyDocuments.kind, kind)),
    )
    .limit(1);
  return row ?? null;
}

export async function getCurrentContent(
  db: Db,
  userId: string,
  sessionId: string,
  kind: DocumentKind,
): Promise<{ documentId: string; content: StudyDocumentContent } | null> {
  const doc = await getDocumentByKind(db, userId, sessionId, kind);
  if (!doc?.currentVersionId) return null;
  const [v] = await db
    .select({ content: studyDocumentVersions.content })
    .from(studyDocumentVersions)
    .where(eq(studyDocumentVersions.id, doc.currentVersionId))
    .limit(1);
  const content = v ? parseContent(v.content) : null;
  return content ? { documentId: doc.id, content } : null;
}

/**
 * Store a new immutable version and make it current. Creates the document
 * row on first use. Returns the version id.
 */
export async function saveDocumentVersion(
  db: Db,
  input: {
    userId: string;
    sessionId: string;
    kind: DocumentKind;
    content: StudyDocumentContent;
    origin: VersionOrigin;
    jobId?: string | null;
    label?: string | null;
  },
): Promise<{ documentId: string; versionId: string; versionNumber: number }> {
  const now = Date.now();
  let doc = await getDocumentByKind(db, input.userId, input.sessionId, input.kind);
  if (!doc) {
    const id = newId();
    await db.insert(studyDocuments).values({
      id,
      userId: input.userId,
      sessionId: input.sessionId,
      kind: input.kind,
      language: input.content.language,
      title: input.content.title,
      currentVersionId: null,
      searchText: "",
      createdAt: now,
      updatedAt: now,
    });
    doc = (await getDocumentByKind(db, input.userId, input.sessionId, input.kind))!;
  }
  const [last] = await db
    .select({ n: studyDocumentVersions.versionNumber })
    .from(studyDocumentVersions)
    .where(eq(studyDocumentVersions.documentId, doc.id))
    .orderBy(desc(studyDocumentVersions.versionNumber))
    .limit(1);
  const versionNumber = (last?.n ?? 0) + 1;
  const versionId = newId();
  const content = { ...input.content, meta: { ...input.content.meta, wordCount: documentWordCount(input.content) } };
  await db.batch([
    db.insert(studyDocumentVersions).values({
      id: versionId,
      userId: input.userId,
      documentId: doc.id,
      versionNumber,
      origin: input.origin,
      content: JSON.stringify(content),
      wordCount: content.meta.wordCount,
      jobId: input.jobId ?? null,
      label: input.label ?? null,
      createdAt: now,
    }),
    db
      .update(studyDocuments)
      .set({
        currentVersionId: versionId,
        language: content.language,
        title: content.title,
        searchText: documentPlainText(content).slice(0, 400_000),
        updatedAt: now,
      })
      .where(eq(studyDocuments.id, doc.id)),
  ]);
  return { documentId: doc.id, versionId, versionNumber };
}

export async function listVersions(db: Db, userId: string, documentId: string) {
  await getDocument(db, userId, documentId);
  return db
    .select({
      id: studyDocumentVersions.id,
      versionNumber: studyDocumentVersions.versionNumber,
      origin: studyDocumentVersions.origin,
      wordCount: studyDocumentVersions.wordCount,
      label: studyDocumentVersions.label,
      createdAt: studyDocumentVersions.createdAt,
    })
    .from(studyDocumentVersions)
    .where(eq(studyDocumentVersions.documentId, documentId))
    .orderBy(desc(studyDocumentVersions.versionNumber));
}

export async function getVersion(db: Db, userId: string, versionId: string) {
  const [v] = await db
    .select()
    .from(studyDocumentVersions)
    .where(and(eq(studyDocumentVersions.id, versionId), eq(studyDocumentVersions.userId, userId)))
    .limit(1);
  if (!v) throw notFound("Versión");
  const content = parseContent(v.content);
  if (!content) throw notFound("Versión");
  return { ...v, content };
}

/** Does the current notes version contain manual edits? (regeneration warns) */
export async function hasUserEdits(db: Db, userId: string, sessionId: string, kind: DocumentKind): Promise<boolean> {
  const current = await getCurrentContent(db, userId, sessionId, kind);
  if (!current) return false;
  return current.content.sections.some((s) => s.edited);
}

// ---------------------------------------------------------------------------
// Retrieval sources derived from notes (chat and search)
// ---------------------------------------------------------------------------

export async function replaceNotesSources(
  db: Db,
  userId: string,
  sessionId: string,
  content: StudyDocumentContent,
): Promise<void> {
  await db
    .delete(documentSources)
    .where(
      and(
        eq(documentSources.sessionId, sessionId),
        eq(documentSources.userId, userId),
        eq(documentSources.sourceType, "notes"),
      ),
    );
  const now = Date.now();
  const rows = content.sections
    .filter((s) => s.markdown.trim())
    .map((s) => ({
      id: newId(),
      userId,
      sessionId,
      sourceType: "notes" as const,
      attachmentId: null,
      pageNumber: null,
      seqFrom: s.refs.length ? Math.min(...s.refs.map((r) => r.seqFrom)) : null,
      seqTo: s.refs.length ? Math.max(...s.refs.map((r) => r.seqTo)) : null,
      startMs: s.refs.length ? Math.min(...s.refs.map((r) => r.startMs)) : null,
      endMs: s.refs.length ? Math.max(...s.refs.map((r) => r.endMs)) : null,
      sectionKey: s.id,
      text: `${s.heading}\n\n${s.markdown.replace(/\[\[ref:[^\]]*\]\]/g, "").trim()}`.slice(0, 60_000),
      embedding: null,
      embeddingModel: null,
      createdAt: now,
    }));
  for (const batch of chunkForInsert(rows, 15)) await db.insert(documentSources).values(batch);
}

// ---------------------------------------------------------------------------
// Exam questions
// ---------------------------------------------------------------------------

export interface QuestionView {
  id: string;
  qtype: "mcq" | "short" | "essay" | "oral" | "case";
  level: number | null;
  concept: string;
  prompt: string;
  options: string[] | null;
  correctOption: number | null;
  answer: string;
  explanation: string | null;
  rubric: string[] | null;
  sourceRefs: SourceRef[];
  extendsSyllabus: boolean;
  createdAt: number;
}

export async function listQuestions(db: Db, userId: string, sessionId: string): Promise<QuestionView[]> {
  return db
    .select({
      id: examQuestions.id,
      qtype: examQuestions.qtype,
      level: examQuestions.level,
      concept: examQuestions.concept,
      prompt: examQuestions.prompt,
      options: examQuestions.options,
      correctOption: examQuestions.correctOption,
      answer: examQuestions.answer,
      explanation: examQuestions.explanation,
      rubric: examQuestions.rubric,
      sourceRefs: examQuestions.sourceRefs,
      extendsSyllabus: examQuestions.extendsSyllabus,
      createdAt: examQuestions.createdAt,
    })
    .from(examQuestions)
    .where(and(eq(examQuestions.sessionId, sessionId), eq(examQuestions.userId, userId)))
    .orderBy(asc(examQuestions.qtype), asc(examQuestions.level), asc(examQuestions.createdAt));
}

export function conceptKey(concept: string): string {
  return concept
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 2)
    .sort()
    .join("-")
    .slice(0, 120);
}
