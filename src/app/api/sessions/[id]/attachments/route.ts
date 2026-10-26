import "@/lib/jobs/register";
import { authedRoute } from "@/lib/api/route";
import { getLectureRow } from "@/lib/data/lectures";
import { listAttachments } from "@/lib/data/attachments";
import { detectKind } from "@/lib/documents/extract";
import { lectureAttachments } from "@/lib/db/schema";
import { sha256Hex } from "@/lib/auth/tokens";
import { newId } from "@/lib/ids";
import { attachmentKey } from "@/lib/storage/keys";
import { enqueueJob } from "@/lib/jobs/queue";
import { AppError, badRequest } from "@/lib/errors";

const MAX_BYTES = 25 * 1024 * 1024;
const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export const GET = authedRoute<{ id: string }>(async ({ db, user, params }) => {
  await getLectureRow(db, user.id, params.id);
  return { attachments: await listAttachments(db, user.id, params.id) };
});

/** Upload a PDF/DOCX/PPTX used in the lecture and queue its text extraction. */
export const POST = authedRoute<{ id: string }>(async ({ db, env, user, params, req }) => {
  await getLectureRow(db, user.id, params.id);
  if (Number(req.headers.get("content-length") ?? "0") > MAX_BYTES + 64 * 1024) {
    throw new AppError(413, "too_large", "El archivo supera los 25 MB.");
  }
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw badRequest("Adjunta un archivo PDF, DOCX o PPTX.");
  if (file.size > MAX_BYTES) throw new AppError(413, "too_large", "El archivo supera los 25 MB.");
  const bytes = await file.arrayBuffer();
  const kind = detectKind(file.name, new Uint8Array(bytes.slice(0, 8)));
  if (!kind) throw badRequest("Formato no admitido o archivo dañado. Se aceptan PDF, DOCX y PPTX.");
  const id = newId();
  const key = attachmentKey(user.id, params.id, id, kind);
  const sha256 = await sha256Hex(bytes);
  await env.FILES.put(key, bytes, {
    httpMetadata: { contentType: MIME[kind] },
    sha256,
    customMetadata: { sessionId: params.id, userId: user.id, fileName: file.name.slice(0, 200) },
  });
  const now = Date.now();
  await db.insert(lectureAttachments).values({
    id,
    userId: user.id,
    sessionId: params.id,
    fileName: file.name.slice(0, 255),
    kind,
    mimeType: MIME[kind]!,
    sizeBytes: bytes.byteLength,
    sha256,
    r2Key: key,
    pageCount: null,
    extractionStatus: "pending",
    extractionError: null,
    createdAt: now,
    updatedAt: now,
  });
  const { job } = await enqueueJob(env, db, {
    userId: user.id,
    sessionId: params.id,
    jobType: "attachment",
    dedupeKey: `attachment:${id}`,
    params: { attachmentId: id },
  });
  const attachments = await listAttachments(db, user.id, params.id);
  return { attachment: attachments.find((a) => a.id === id), job };
});
