import { and, eq } from "drizzle-orm";
import { authedRoute } from "@/lib/api/route";
import { getLectureRow } from "@/lib/data/lectures";
import { audioChunks } from "@/lib/db/schema";
import { sha256Hex } from "@/lib/auth/tokens";
import { audioChunkKey } from "@/lib/storage/keys";
import { AppError, badRequest, conflict } from "@/lib/errors";
import { isUuid } from "@/lib/ids";

const MAX_CHUNK_BYTES = 25 * 1024 * 1024;
const ALLOWED_AUDIO = /^audio\/(webm|mp4|ogg|wav|mpeg)(;.*)?$/i;

function intHeader(req: Request, name: string, opts: { min?: number } = {}): number {
  const v = Number(req.headers.get(name));
  if (!Number.isFinite(v) || (opts.min !== undefined && v < opts.min)) throw badRequest(`Cabecera ${name} no válida`);
  return Math.round(v);
}

/**
 * Idempotent upload of one audio chunk. The server recomputes the SHA-256,
 * stores the bytes in R2 (with R2-side integrity check) and only then
 * records the chunk. The client marks a chunk as synced only after a 200.
 */
export const PUT = authedRoute<{ id: string; seq: string }>(async ({ db, env, user, params, req }) => {
  const sessionId = params.id;
  const seq = Number(params.seq);
  if (!Number.isInteger(seq) || seq < 0 || seq > 100_000) throw badRequest("Secuencia no válida");
  await getLectureRow(db, user.id, sessionId);

  const chunkId = req.headers.get("x-chunk-id") ?? "";
  if (!isUuid(chunkId)) throw badRequest("x-chunk-id no válido");
  const claimedSha = (req.headers.get("x-sha256") ?? "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(claimedSha)) throw badRequest("x-sha256 no válido");
  const mime = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!ALLOWED_AUDIO.test(mime)) throw badRequest("Formato de audio no permitido");
  const startMs = intHeader(req, "x-start-ms", { min: 0 });
  const endMs = intHeader(req, "x-end-ms", { min: 0 });
  const durationMs = intHeader(req, "x-duration-ms", { min: 0 });
  const overlapMs = intHeader(req, "x-overlap-ms", { min: 0 });
  const partial = req.headers.get("x-partial") === "1";
  if (endMs < startMs) throw badRequest("Rango temporal no válido");

  const [existing] = await db
    .select()
    .from(audioChunks)
    .where(and(eq(audioChunks.sessionId, sessionId), eq(audioChunks.userId, user.id), eq(audioChunks.seq, seq)))
    .limit(1);
  if (existing) {
    if (existing.sha256 === claimedSha) {
      return { ok: true, alreadyStored: true, chunk: { id: existing.id, seq, sha256: existing.sha256 } };
    }
    throw conflict("Ya existe un fragmento distinto con esta secuencia.", "chunk_conflict");
  }

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_CHUNK_BYTES) throw new AppError(413, "too_large", "Fragmento demasiado grande");
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_CHUNK_BYTES) throw badRequest("Tamaño de fragmento no válido");
  const actualSha = await sha256Hex(bytes);
  if (actualSha !== claimedSha) {
    throw new AppError(422, "integrity_mismatch", "El fragmento llegó dañado; se reintentará.");
  }

  const key = audioChunkKey(user.id, sessionId, seq, chunkId, mime);
  await env.FILES.put(key, bytes, {
    httpMetadata: { contentType: mime.split(";")[0] },
    sha256: actualSha,
    customMetadata: { sessionId, seq: String(seq), userId: user.id },
  });
  await db
    .insert(audioChunks)
    .values({
      id: chunkId,
      userId: user.id,
      sessionId,
      seq,
      startMs,
      endMs,
      durationMs,
      overlapMs,
      mimeType: mime,
      sizeBytes: bytes.byteLength,
      sha256: actualSha,
      r2Key: key,
      partial,
      createdAt: Date.now(),
    })
    .onConflictDoNothing();
  return { ok: true, alreadyStored: false, chunk: { id: chunkId, seq, sha256: actualSha } };
});
