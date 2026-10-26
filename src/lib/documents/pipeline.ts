// Attachment extraction job: reads the file from R2, extracts page text and
// stores it as retrieval sources (embedded lazily by the chat index).
import { and, eq } from "drizzle-orm";
import { chunkForInsert } from "@/lib/db";
import { documentSources, lectureAttachments } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import type { JobContext } from "@/lib/jobs/runner";
import { registerJobHandler } from "@/lib/jobs/handlers";
import { extractPages } from "./extract";

export interface AttachmentJobParams {
  attachmentId: string;
}

async function attachmentHandler(ctx: JobContext): Promise<Record<string, unknown>> {
  const { attachmentId } = ctx.job.params as unknown as AttachmentJobParams;
  const [att] = await ctx.db
    .select()
    .from(lectureAttachments)
    .where(and(eq(lectureAttachments.id, attachmentId), eq(lectureAttachments.userId, ctx.job.userId)))
    .limit(1);
  if (!att) ctx.fail("El documento ya no existe.");
  await ctx.setStage("Leyendo el documento");
  await ctx.db
    .update(lectureAttachments)
    .set({ extractionStatus: "processing", updatedAt: Date.now() })
    .where(eq(lectureAttachments.id, att.id));

  try {
    const result = await ctx.step("extract", async () => {
      const obj = await ctx.env.FILES.get(att.r2Key);
      if (!obj) ctx.fail("El archivo no está en el almacenamiento.");
      const extracted = await extractPages(att.kind, await obj.arrayBuffer());
      await ctx.db
        .delete(documentSources)
        .where(and(eq(documentSources.attachmentId, att.id), eq(documentSources.userId, ctx.job.userId)));
      const now = Date.now();
      const rows = extracted.pages.map((p) => ({
        id: newId(),
        userId: ctx.job.userId,
        sessionId: att.sessionId,
        sourceType: "attachment" as const,
        attachmentId: att.id,
        pageNumber: p.page,
        seqFrom: null,
        seqTo: null,
        startMs: null,
        endMs: null,
        sectionKey: null,
        text: p.text,
        embedding: null,
        embeddingModel: null,
        createdAt: now,
      }));
      for (const batch of chunkForInsert(rows, 15)) await ctx.db.insert(documentSources).values(batch);
      return { pageCount: extracted.pageCount, pagesWithText: rows.length, needsOcr: extracted.needsOcr };
    });
    await ctx.db
      .update(lectureAttachments)
      .set({
        extractionStatus: result.needsOcr ? "needs_ocr" : "ready",
        pageCount: result.pageCount,
        extractionError: result.needsOcr
          ? "El documento no contiene texto legible (probablemente escaneado). Se adjunta, pero la IA no puede leerlo."
          : null,
        updatedAt: Date.now(),
      })
      .where(eq(lectureAttachments.id, att.id));
    await ctx.setStage("Documento procesado");
    return result;
  } catch (err) {
    await ctx.db
      .update(lectureAttachments)
      .set({
        extractionStatus: "failed",
        extractionError: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        updatedAt: Date.now(),
      })
      .where(eq(lectureAttachments.id, att.id));
    throw err;
  }
}

registerJobHandler("attachment", attachmentHandler);
