import { authedRoute } from "@/lib/api/route";
import { getChunk } from "@/lib/data/lectures";
import { badRequest, notFound } from "@/lib/errors";

function parseRange(header: string | null, size: number): { offset: number; length: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let start = m[1] ? Number(m[1]) : NaN;
  let end = m[2] ? Number(m[2]) : NaN;
  if (Number.isNaN(start)) {
    if (Number.isNaN(end)) return null;
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (Number.isNaN(end) || end >= size) {
    end = size - 1;
  }
  if (start > end || start >= size) return null;
  return { offset: start, length: end - start + 1 };
}

/** Streams a stored audio chunk (private; Range requests supported for seeking). */
export const GET = authedRoute<{ id: string; seq: string }>(async ({ db, env, user, params, req }) => {
  const seq = Number(params.seq);
  if (!Number.isInteger(seq) || seq < 0) throw badRequest("Secuencia no válida");
  const chunk = await getChunk(db, user.id, params.id, seq);
  const range = parseRange(req.headers.get("range"), chunk.sizeBytes);
  const obj = await env.FILES.get(chunk.r2Key, range ? { range } : undefined);
  if (!obj) throw notFound("Audio");
  const headers = new Headers({
    "Content-Type": chunk.mimeType.split(";")[0]!,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  if (range) {
    headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${chunk.sizeBytes}`);
    headers.set("Content-Length", String(range.length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(chunk.sizeBytes));
  return new Response(obj.body, { status: 200, headers });
});
