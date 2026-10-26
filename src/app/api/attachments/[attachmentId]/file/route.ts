import { authedRoute } from "@/lib/api/route";
import { getAttachment } from "@/lib/data/attachments";
import { notFound } from "@/lib/errors";

/** Private download of the original file (inline for PDFs). */
export const GET = authedRoute<{ attachmentId: string }>(async ({ db, env, user, params, req }) => {
  const att = await getAttachment(db, user.id, params.attachmentId);
  const obj = await env.FILES.get(att.r2Key);
  if (!obj) throw notFound("Archivo");
  const download = req.nextUrl.searchParams.get("download") === "1";
  const safeName = att.fileName.replace(/[^\w.\- ]+/g, "_");
  return new Response(obj.body, {
    headers: {
      "Content-Type": att.mimeType,
      "Content-Length": String(att.sizeBytes),
      "Content-Disposition": `${download || att.kind !== "pdf" ? "attachment" : "inline"}; filename="${safeName}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
