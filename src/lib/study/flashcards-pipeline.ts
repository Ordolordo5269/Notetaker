// Flashcard generation job: cards grounded in the notes (or the transcript
// when notes do not exist yet), de-duplicated per subject by concept key.
import { and, eq, inArray } from "drizzle-orm";
import { flashcards, lectureSessions, type CardType, type DocumentLanguage, type SourceRef } from "@/lib/db/schema";
import { createStructured } from "@/lib/openai/client";
import { newId } from "@/lib/ids";
import { conceptKey, getCurrentContent, loadSourceSegments } from "@/lib/data/documents";
import type { JobContext } from "@/lib/jobs/runner";
import { registerJobHandler } from "@/lib/jobs/handlers";
import { FIDELITY_RULES, languageInstruction, resolveLanguage } from "@/lib/notes/prompts";
import { consolidate, normalizeRefs, renderRanges } from "@/lib/notes/transcript";
import { STAGES } from "@/lib/notes/pipeline";

export interface FlashcardsParams {
  language: DocumentLanguage | "auto";
  maxCards: number;
}

interface GeneratedCard {
  cardType: CardType;
  front: string;
  back: string;
  concept: string;
  refs: string;
}

const cardsSchema = {
  name: "flashcards",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["cards"],
    properties: {
      cards: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["cardType", "front", "back", "concept", "refs"],
          properties: {
            cardType: { type: "string", enum: ["definition", "qa", "article", "term", "comparison", "exception"] },
            front: { type: "string" },
            back: { type: "string" },
            concept: { type: "string", description: "Concepto único que evalúa la tarjeta (corto)." },
            refs: { type: "string", description: "Tramos [[ref:a-b]] de la transcripción." },
          },
        },
      },
    },
  },
};

function system(language: DocumentLanguage, dominant: "es" | "en"): string {
  return `Eres un estudiante que crea flashcards de repaso espaciado a partir de una clase universitaria. Tipos: definition (concepto → definición), qa (pregunta → respuesta), article (artículo o norma → qué establece), term (término técnico → explicación), comparison (dos conceptos → diferencia), exception (regla → excepción). El anverso debe ser breve y sin la respuesta; el reverso, preciso y autosuficiente (2-5 líneas), con la cita [[ref:a-b]] al final. Una sola idea por tarjeta y ningún concepto repetido. Prioriza lo que el profesor marcó como importante o de examen.
${languageInstruction(language, dominant)}

${FIDELITY_RULES}`;
}

async function flashcardsHandler(ctx: JobContext): Promise<Record<string, unknown>> {
  const sessionId = ctx.job.sessionId;
  if (!sessionId) ctx.fail("El trabajo no tiene clase asociada.");
  const params = ctx.job.params as unknown as FlashcardsParams;
  const { config } = ctx;
  await ctx.setStage(STAGES.prepare);
  const segments = await loadSourceSegments(ctx.db, ctx.job.userId, sessionId);
  const transcript = consolidate(segments);
  if (!transcript.blocks.length) ctx.fail("La clase no tiene transcripción suficiente.");
  const notes = await getCurrentContent(ctx.db, ctx.job.userId, sessionId, "notes");
  const language = resolveLanguage(params.language ?? "auto", transcript.dominantLanguage);
  const [lecture] = await ctx.db
    .select({ title: lectureSessions.title, subjectId: lectureSessions.subjectId })
    .from(lectureSessions)
    .where(eq(lectureSessions.id, sessionId))
    .limit(1);
  if (!lecture) ctx.fail("La clase ya no existe.");

  // Existing concepts in the same subject: tell the model to avoid them.
  const existing = await ctx.db
    .select({ conceptKey: flashcards.conceptKey, front: flashcards.front })
    .from(flashcards)
    .where(
      and(
        eq(flashcards.userId, ctx.job.userId),
        lecture.subjectId ? eq(flashcards.subjectId, lecture.subjectId) : eq(flashcards.sessionId, sessionId),
      ),
    );
  const existingKeys = new Set(existing.map((e) => e.conceptKey));

  await ctx.setStage("Redactando tarjetas");
  const max = Math.min(120, Math.max(5, params.maxCards ?? 40));
  const material = notes
    ? `APUNTES:\n${notes.content.sections
        .map((s) => `## ${s.heading}\n${s.markdown}`)
        .join("\n\n")
        .slice(0, 120_000)}`
    : `TRANSCRIPCIÓN:\n${renderRanges(transcript.segments, transcript.blocks, 40_000)}`;
  const created = await ctx.step("cards", async () => {
    const { data, usage } = await createStructured<{ cards: GeneratedCard[] }>(config, {
      model: config.models.fast,
      system: system(language, transcript.dominantLanguage),
      user: `Clase: "${lecture.title}". Genera como máximo ${max} tarjetas.${
        existing.length
          ? `\nYa existen tarjetas para estos conceptos (no los repitas): ${existing
              .map((e) => e.front)
              .slice(0, 80)
              .join(" | ")}`
          : ""
      }\n\n${material}`,
      schema: cardsSchema,
      reasoningEffort: "low",
      maxOutputTokens: 9000,
    });
    await ctx.usage({
      kind: "llm",
      model: config.models.fast,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
    });
    const now = Date.now();
    const seen = new Set<string>();
    const rows = [];
    for (const c of data.cards) {
      const key = conceptKey(c.concept || c.front);
      if (!key || seen.has(key) || existingKeys.has(key) || !c.front.trim() || !c.back.trim()) continue;
      seen.add(key);
      const { markdown, refs } = normalizeRefs(c.back, transcript.segments);
      const sourceRefs: SourceRef[] = refs.map((r) => ({ kind: "transcript", ...r }));
      rows.push({
        id: newId(),
        userId: ctx.job.userId,
        sessionId,
        subjectId: lecture.subjectId,
        cardType: c.cardType,
        front: c.front.trim().slice(0, 2000),
        back: markdown.trim().slice(0, 6000),
        conceptKey: key,
        sourceRefs,
        ease: 2.5,
        intervalDays: 0,
        repetitions: 0,
        lapses: 0,
        dueAt: now,
        lastReviewedAt: null,
        suspended: false,
        createdAt: now,
        updatedAt: now,
      });
      if (rows.length >= max) break;
    }
    for (let i = 0; i < rows.length; i += 5) {
      await ctx.db
        .insert(flashcards)
        .values(rows.slice(i, i + 5))
        .onConflictDoNothing();
    }
    return rows.length;
  });
  // Rows may have been skipped by the unique index (same concept in another lecture of the subject).
  const [count] = await ctx.db
    .select({ n: flashcards.id })
    .from(flashcards)
    .where(and(eq(flashcards.sessionId, sessionId), inArray(flashcards.userId, [ctx.job.userId])));
  void count;
  await ctx.setStage(STAGES.done);
  return { created };
}

registerJobHandler("flashcards", flashcardsHandler);
