import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { documentSources, lectureAttachments } from "@/lib/db/schema";
import { notFound } from "@/lib/errors";

export interface AttachmentView {
  id: string;
  sessionId: string;
  fileName: string;
  kind: "pdf" | "docx" | "pptx";
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  extractionStatus: "pending" | "processing" | "ready" | "needs_ocr" | "failed";
  extractionError: string | null;
  createdAt: number;
}

const cols = {
  id: lectureAttachments.id,
  sessionId: lectureAttachments.sessionId,
  fileName: lectureAttachments.fileName,
  kind: lectureAttachments.kind,
  mimeType: lectureAttachments.mimeType,
  sizeBytes: lectureAttachments.sizeBytes,
  pageCount: lectureAttachments.pageCount,
  extractionStatus: lectureAttachments.extractionStatus,
  extractionError: lectureAttachments.extractionError,
  createdAt: lectureAttachments.createdAt,
};

export async function listAttachments(db: Db, userId: string, sessionId: string): Promise<AttachmentView[]> {
  return db
    .select(cols)
    .from(lectureAttachments)
    .where(and(eq(lectureAttachments.sessionId, sessionId), eq(lectureAttachments.userId, userId)))
    .orderBy(asc(lectureAttachments.createdAt));
}

export async function getAttachment(db: Db, userId: string, attachmentId: string) {
  const [row] = await db
    .select()
    .from(lectureAttachments)
    .where(and(eq(lectureAttachments.id, attachmentId), eq(lectureAttachments.userId, userId)))
    .limit(1);
  if (!row) throw notFound("Documento");
  return row;
}

export async function listAttachmentPages(db: Db, userId: string, attachmentId: string) {
  await getAttachment(db, userId, attachmentId);
  return db
    .select({ page: documentSources.pageNumber, text: documentSources.text })
    .from(documentSources)
    .where(and(eq(documentSources.attachmentId, attachmentId), eq(documentSources.userId, userId)))
    .orderBy(asc(documentSources.pageNumber));
}

export async function deleteAttachment(db: Db, bucket: R2Bucket, userId: string, attachmentId: string) {
  const att = await getAttachment(db, userId, attachmentId);
  await bucket.delete(att.r2Key);
  await db.delete(lectureAttachments).where(eq(lectureAttachments.id, attachmentId));
}
