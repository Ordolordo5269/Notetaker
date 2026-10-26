// AI pipelines: complete notes, summaries and exam questions.
//
// Each job runs inside the job runner (Workflow in production). Every step
// persists its output, so a retry resumes where it stopped. Stage names are
// the real pipeline stages shown in the UI.
import { and, eq } from "drizzle-orm";
import { chunkForInsert } from "@/lib/db";
import { examQuestions, lectureMarkers, lectureSessions, subjects } from "@/lib/db/schema";
import { createStructured, type OpenAIUsage } from "@/lib/openai/client";
import { newId } from "@/lib/ids";
import { formatClock } from "@/lib/time";
import {
  conceptKey,
  getCurrentContent,
  loadAttachmentPages,
  loadSourceSegments,
  replaceNotesSources,
  saveDocumentVersion,
  type AttachmentPage,
} from "@/lib/data/documents";
import type { JobContext } from "@/lib/jobs/runner";
import { registerJobHandler } from "@/lib/jobs/handlers";
import {
  extractionSchema,
  extractionSystem,
  outlineSchema,
  outlineSystem,
  questionsSchema,
  questionsSystem,
  resolveLanguage,
  reviewSchema,
  reviewSystem,
  sectionSchema,
  sectionSystem,
  summarySchema,
  summarySystem,
  SUMMARY_SPECS,
  type BlockExtraction,
  type GeneratedQuestion,
  type Outline,
  type OutlineSection,
  type ReviewResult,
  type SectionDraft,
  type SummaryMode,
} from "./prompts";
import {
  consolidate,
  describeRefs,
  normalizeRefs,
  renderRange,
  renderRanges,
  type ConsolidatedTranscript,
  type SourceSegment,
} from "./transcript";
import { countWords, type DocumentSection, type StudyDocumentContent, type TranscriptRef } from "./types";
import type { DocumentLanguage, SourceRef } from "@/lib/db/schema";

export const STAGES = {
  prepare: "Preparando transcripción",
  topics: "Identificando temas",
  outline: "Estructurando el documento",
  draft: "Redactando apuntes",
  review: "Verificando contenido",
  done: "Documento terminado",
} as const;

const MAX_SECTION_CONTEXT_TOKENS = 14_000;
const MAX_ATTACHMENT_TOKENS_PER_SECTION = 3_000;
const DRAFT_CONCURRENCY = 3;

interface LectureContext {
  title: string;
  subjectName: string | null;
  markers: { type: string; atMs: number; note: string | null }[];
}

async function loadLectureContext(ctx: JobContext, sessionId: string): Promise<LectureContext> {
  const [row] = await ctx.db
    .select({ title: lectureSessions.title, subjectName: subjects.name })
    .from(lectureSessions)
    .leftJoin(subjects, eq(subjects.id, lectureSessions.subjectId))
    .where(and(eq(lectureSessions.id, sessionId), eq(lectureSessions.userId, ctx.job.userId)))
    .limit(1);
  if (!row) ctx.fail("La clase ya no existe.");
  const markers = await ctx.db
    .select({ type: lectureMarkers.type, atMs: lectureMarkers.atMs, note: lectureMarkers.note })
    .from(lectureMarkers)
    .where(eq(lectureMarkers.sessionId, sessionId));
  return { title: row.title, subjectName: row.subjectName, markers };
}

async function assertNotCancelled(ctx: JobContext) {
  const [row] = await ctx.db
    .select({ status: ctxJobs.status })
    .from(ctxJobs)
    .where(eq(ctxJobs.id, ctx.job.id))
    .limit(1);
  if (row?.status === "cancelled") ctx.fail("Trabajo cancelado por el usuario.");
}
import { processingJobs as ctxJobs } from "@/lib/db/schema";

function usageTotal(ctx: JobContext, model: string, u: OpenAIUsage) {
  return ctx.usage({
    kind: "llm",
    model,
    inputTokens: u.inputTokens,
    cachedInputTokens: u.cachedInputTokens,
    outputTokens: u.outputTokens,
  });
}

function extractionChecklist(extractions: BlockExtraction[]): string[] {
  const items: string[] = [];
  for (const e of extractions) {
    for (const t of e.topics) items.push(`Tema: ${t.title}`);
    for (const d of e.definitions) items.push(`Definición: ${d.term}`);
    for (const n of e.norms) items.push(`Norma/teoría: ${n.name}`);
    for (const x of e.examples) items.push(`Ejemplo: ${x.description.slice(0, 120)}`);
    for (const x of e.exceptions) items.push(`Excepción: ${x.text.slice(0, 120)}`);
    for (const x of e.comparisons) items.push(`Comparación: ${x.text.slice(0, 120)}`);
    for (const x of e.examWarnings) items.push(`Aviso de examen: ${x.text.slice(0, 120)}`);
  }
  // Deduplicate near-identical lines.
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = i
      .toLowerCase()
      .replace(/[^a-z0-9áéíóúñ]+/g, " ")
      .trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function extractionDigest(extractions: BlockExtraction[], blocks: ConsolidatedTranscript["blocks"]): string {
  return extractions
    .map((e, i) => {
      const b = blocks[i]!;
      const lines = [
        `## Bloque ${i + 1} (segmentos ${b.seqFrom}-${b.seqTo}, ${formatClock(b.startMs)}–${formatClock(b.endMs)})`,
        ...e.topics.map((t) => `- Tema: ${t.title} — ${t.summary} [${t.refs}]`),
        ...e.definitions.map((d) => `- Definición: ${d.term}: ${d.definition} [${d.refs}]`),
        ...e.norms.map((n) => `- Norma: ${n.name}: ${n.content} [${n.refs}]`),
        ...e.examples.map((x) => `- Ejemplo: ${x.description} (ilustra: ${x.illustrates}) [${x.refs}]`),
        ...e.exceptions.map((x) => `- Excepción: ${x.text} [${x.refs}]`),
        ...e.comparisons.map((x) => `- Comparación: ${x.text} [${x.refs}]`),
        ...e.teacherComments.map((x) => `- Comentario del profesor: ${x.text} [${x.refs}]`),
        ...e.examWarnings.map((x) => `- Aviso de examen: ${x.text} [${x.refs}]`),
        ...e.ambiguities.map((x) => `- Ambigüedad: ${x.text} [${x.refs}]`),
      ];
      return lines.join("\n");
    })
    .join("\n\n");
}

function parseRanges(ranges: readonly string[], fallback: { seqFrom: number; seqTo: number }[]) {
  const out: { seqFrom: number; seqTo: number }[] = [];
  for (const r of ranges) {
    const m = /^\s*s?(\d+)\s*[-–]\s*s?(\d+)\s*$/.exec(r) ?? /^\s*s?(\d+)\s*$/.exec(r);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2] ?? m[1]);
    out.push({ seqFrom: Math.min(a, b), seqTo: Math.max(a, b) });
  }
  return out.length ? out : fallback;
}

function attachmentExcerpt(pages: AttachmentPage[], maxTokens: number, keywords: string[]): string {
  if (!pages.length) return "";
  // Pick pages that share the most words with the section purpose/heading.
  const kw = keywords.map((k) => k.toLowerCase()).filter((k) => k.length > 3);
  const scored = pages
    .map((p) => {
      const lower = p.text.toLowerCase();
      const score = kw.reduce((n, k) => n + (lower.includes(k) ? 1 : 0), 0);
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  let tokens = 0;
  const out: string[] = [];
  for (const { p } of scored) {
    const t = Math.ceil(p.text.length / 4) + 10;
    if (tokens + t > maxTokens) break;
    tokens += t;
    out.push(`[${p.fileName}, p. ${p.page}]\n${p.text.trim()}`);
  }
  return out.join("\n\n");
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export interface NotesParams {
  language: DocumentLanguage | "auto";
  includeAttachments: boolean;
  label?: string;
}

async function notesHandler(ctx: JobContext): Promise<Record<string, unknown>> {
  const sessionId = ctx.job.sessionId;
  if (!sessionId) ctx.fail("El trabajo no tiene clase asociada.");
  const params = ctx.job.params as unknown as NotesParams;
  const { config } = ctx;

  // Step 1 — consolidate transcript.
  await ctx.setStage(STAGES.prepare);
  const segments = await loadSourceSegments(ctx.db, ctx.job.userId, sessionId);
  const transcript = consolidate(segments);
  if (!transcript.blocks.length) ctx.fail("La clase no tiene transcripción suficiente para generar apuntes.");
  const lecture = await loadLectureContext(ctx, sessionId);
  const attachments = params.includeAttachments ? await loadAttachmentPages(ctx.db, ctx.job.userId, sessionId) : [];
  const language = resolveLanguage(params.language ?? "auto", transcript.dominantLanguage);
  const dominant = transcript.dominantLanguage;
  const subjectLine = lecture.subjectName ? `Asignatura: ${lecture.subjectName}. ` : "";

  // Step 2 — per-block extraction.
  await ctx.setStage(STAGES.topics);
  const extractions: BlockExtraction[] = [];
  for (const block of transcript.blocks) {
    await assertNotCancelled(ctx);
    const result = await ctx.step(`extract:${block.index}`, async () => {
      const text = renderRange(transcript.segments, block.seqFrom, block.seqTo);
      const { data, usage } = await createStructured<BlockExtraction>(config, {
        model: config.models.fast,
        system: extractionSystem,
        user: `${subjectLine}Clase: "${lecture.title}". Bloque ${block.index + 1} de ${transcript.blocks.length} (${formatClock(block.startMs)}–${formatClock(block.endMs)}).\n\nTRANSCRIPCIÓN:\n${text}`,
        schema: extractionSchema,
        reasoningEffort: "low",
        maxOutputTokens: 6000,
      });
      await usageTotal(ctx, config.models.fast, usage);
      return data;
    });
    extractions.push(result);
  }

  // Step 3 — global outline.
  await ctx.setStage(STAGES.outline);
  const outline = await ctx.step("outline", async () => {
    const markersText = lecture.markers.length
      ? lecture.markers.map((m) => `- ${formatClock(m.atMs)} ${m.type}${m.note ? `: ${m.note}` : ""}`).join("\n")
      : "(ninguno)";
    const { data, usage } = await createStructured<Outline>(config, {
      model: config.models.notes,
      system: outlineSystem,
      user: `${subjectLine}Clase: "${lecture.title}". Duración: ${formatClock(transcript.durationMs)}. Idioma de los apuntes: ${language}.
Huecos detectados: ${transcript.gaps.length ? transcript.gaps.join("; ") : "ninguno"}.

MARCADORES DEL ALUMNO:
${markersText}

ELEMENTOS EXTRAÍDOS POR BLOQUE:
${extractionDigest(extractions, transcript.blocks)}`,
      schema: outlineSchema,
      reasoningEffort: "medium",
      maxOutputTokens: 6000,
    });
    await usageTotal(ctx, config.models.notes, usage);
    return data;
  });
  const outlineSections = sanitizeOutline(outline.sections, transcript);

  // Step 4 — draft sections (bounded concurrency).
  await ctx.setStage(`${STAGES.draft} (0/${outlineSections.length})`);
  const drafts = new Map<string, SectionDraft>();
  let done = 0;
  const queue = [...outlineSections];
  const workers = Array.from({ length: Math.min(DRAFT_CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const section = queue.shift()!;
      await assertNotCancelled(ctx);
      const draft = await ctx.step(`draft:${section.id}`, () =>
        draftSection(ctx, {
          section,
          outline: outlineSections,
          transcript,
          extractions,
          attachments,
          language,
          dominant,
          lecture,
          extraInstructions: null,
        }),
      );
      drafts.set(section.id, draft);
      done++;
      await ctx.setStage(`${STAGES.draft} (${done}/${outlineSections.length})`);
    }
  });
  await Promise.all(workers);

  // Step 5 — review coverage against the extraction checklist.
  await ctx.setStage(STAGES.review);
  const checklist = extractionChecklist(extractions);
  const review = await ctx.step("review", async () => {
    const draftText = outlineSections
      .map((s) => `${"#".repeat(s.level)} ${s.heading} (id: ${s.id})\n${drafts.get(s.id)?.markdown ?? ""}`)
      .join("\n\n");
    const { data, usage } = await createStructured<ReviewResult>(config, {
      model: config.models.notes,
      system: reviewSystem,
      user: `LISTA DE CONTROL (${checklist.length} elementos):\n${checklist.map((c) => `- ${c}`).join("\n")}\n\nBORRADOR:\n${draftText}`,
      schema: reviewSchema,
      reasoningEffort: "medium",
      maxOutputTokens: 5000,
    });
    await usageTotal(ctx, config.models.notes, usage);
    return data;
  });

  // Step 6 — one targeted pass over sections with missing items.
  const missingBySection = new Map<string, string[]>();
  for (const m of review.missing) {
    const id = outlineSections.some((s) => s.id === m.sectionId)
      ? m.sectionId
      : outlineSections[outlineSections.length - 1]!.id;
    missingBySection.set(id, [...(missingBySection.get(id) ?? []), m.item]);
  }
  const highIssues = review.issues.filter((i) => i.severity === "high");
  for (const i of highIssues) {
    if (outlineSections.some((s) => s.id === i.sectionId)) {
      missingBySection.set(i.sectionId, [...(missingBySection.get(i.sectionId) ?? []), `Corrige: ${i.issue}`]);
    }
  }
  const patched = new Set<string>();
  for (const [sectionId, items] of missingBySection) {
    const section = outlineSections.find((s) => s.id === sectionId);
    if (!section) continue;
    await assertNotCancelled(ctx);
    const draft = await ctx.step(`patch:${sectionId}`, () =>
      draftSection(ctx, {
        section,
        outline: outlineSections,
        transcript,
        extractions,
        attachments,
        language,
        dominant,
        lecture,
        extraInstructions: `Esta es una segunda redacción. El borrador anterior omitía o trataba mal los siguientes puntos, que DEBEN quedar cubiertos (solo si la transcripción los respalda):\n${items.map((i) => `- ${i}`).join("\n")}\n\nBORRADOR ANTERIOR:\n${drafts.get(sectionId)?.markdown ?? ""}`,
      }),
    );
    drafts.set(sectionId, draft);
    patched.add(sectionId);
  }

  // Step 7 — assemble, persist, index.
  const sections: DocumentSection[] = outlineSections.map((s) => {
    const d = drafts.get(s.id) ?? { markdown: "", ambiguities: [] };
    const { markdown, refs } = normalizeRefs(d.markdown, transcript.segments);
    return { id: s.id, heading: s.heading, level: s.level, markdown, refs, ambiguities: d.ambiguities };
  });
  const uncovered = review.missing
    .filter((m) => !patched.has(m.sectionId))
    .map((m) => m.item)
    .slice(0, 100);
  const content: StudyDocumentContent = {
    version: 1,
    title: outline.title?.trim() || lecture.title,
    language,
    sections,
    meta: {
      generatedAt: Date.now(),
      model: config.models.notes,
      uncovered,
      gaps: transcript.gaps,
      wordCount: sections.reduce((n, s) => n + countWords(s.markdown), 0),
      sourceSegments: transcript.segments.filter((s) => s.status === "final").length,
      attachments: [...new Set(attachments.map((a) => a.fileName))],
    },
  };
  const saved = await ctx.step("persist", async () => {
    const result = await saveDocumentVersion(ctx.db, {
      userId: ctx.job.userId,
      sessionId,
      kind: "notes",
      content,
      origin: "ai",
      jobId: ctx.job.id,
      label: params.label ?? null,
    });
    await replaceNotesSources(ctx.db, ctx.job.userId, sessionId, content);
    return result;
  });
  await ctx.setStage(STAGES.done);
  return {
    documentId: saved.documentId,
    versionId: saved.versionId,
    sections: sections.length,
    words: content.meta.wordCount,
    uncovered: uncovered.length,
    reviewSummary: review.summary,
  };
}

/** Level-2 sections that follow a level-1 section until the next level-1. */
function childrenOf(outline: OutlineSection[], parentId: string): OutlineSection[] {
  const idx = outline.findIndex((s) => s.id === parentId);
  if (idx === -1 || outline[idx]!.level !== 1) return [];
  const out: OutlineSection[] = [];
  for (let i = idx + 1; i < outline.length && outline[i]!.level === 2; i++) out.push(outline[i]!);
  return out;
}

function sanitizeOutline(sections: OutlineSection[], transcript: ConsolidatedTranscript): OutlineSection[] {
  const all = { seqFrom: transcript.blocks[0]!.seqFrom, seqTo: transcript.blocks[transcript.blocks.length - 1]!.seqTo };
  const used = new Set<string>();
  const out: OutlineSection[] = [];
  for (const s of sections.slice(0, 40)) {
    let id = (s.id || s.heading)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    if (!id) id = `sec-${out.length + 1}`;
    let candidate = id;
    let n = 2;
    while (used.has(candidate)) candidate = `${id}-${n++}`;
    used.add(candidate);
    const ranges = parseRanges(s.ranges ?? [], [all]).map((r) => `${r.seqFrom}-${r.seqTo}`);
    out.push({
      id: candidate,
      heading: s.heading.trim() || `Sección ${out.length + 1}`,
      level: s.level === 2 ? 2 : 1,
      purpose: s.purpose,
      ranges,
      weight: Math.min(5, Math.max(1, Math.round(s.weight || 3))),
    });
  }
  return out;
}

async function draftSection(
  ctx: JobContext,
  input: {
    section: OutlineSection;
    outline: OutlineSection[];
    transcript: ConsolidatedTranscript;
    extractions: BlockExtraction[];
    attachments: AttachmentPage[];
    language: DocumentLanguage;
    dominant: "es" | "en";
    lecture: LectureContext;
    extraInstructions: string | null;
  },
): Promise<SectionDraft> {
  const { config } = ctx;
  const { section, transcript } = input;
  const ranges = parseRanges(section.ranges, [
    { seqFrom: transcript.blocks[0]!.seqFrom, seqTo: transcript.blocks[transcript.blocks.length - 1]!.seqTo },
  ]);
  const children = section.level === 1 ? childrenOf(input.outline, section.id) : [];
  const overviewOnly = children.length > 0;
  const budget = Math.round(MAX_SECTION_CONTEXT_TOKENS * (overviewOnly ? 0.35 : 0.4 + section.weight * 0.12));
  const excerpt = renderRanges(transcript.segments, ranges, budget);
  const relatedBlocks = transcript.blocks.filter((b) =>
    ranges.some((r) => r.seqFrom <= b.seqTo && r.seqTo >= b.seqFrom),
  );
  const related = relatedBlocks.map((b) => input.extractions[b.index]).filter((e): e is BlockExtraction => Boolean(e));
  const relatedDigest = extractionDigest(related, relatedBlocks).slice(0, 12_000);
  const slides = attachmentExcerpt(
    input.attachments,
    MAX_ATTACHMENT_TOKENS_PER_SECTION,
    `${section.heading} ${section.purpose}`.split(/\W+/),
  );
  const toc = input.outline
    .map((s) => `${s.level === 2 ? "  - " : "- "}${s.heading}${s.id === section.id ? "  ← esta sección" : ""}`)
    .join("\n");
  const user = `${input.lecture.subjectName ? `Asignatura: ${input.lecture.subjectName}. ` : ""}Clase: "${input.lecture.title}".

ÍNDICE COMPLETO DEL DOCUMENTO:
${toc}

SECCIÓN A REDACTAR: "${section.heading}" (nivel ${section.level}, peso ${section.weight}/5)
Propósito: ${section.purpose}
${
  overviewOnly
    ? `ATENCIÓN: esta sección tiene subsecciones propias (${children.map((c) => `"${c.heading}"`).join(", ")}) que se redactan aparte con todo el detalle. Escribe aquí SOLO una introducción breve (máximo 150 palabras): qué se trata en el bloque, por qué importa y cómo se relacionan las subsecciones. No desarrolles su contenido ni añadas subencabezados.`
    : ""
}
${input.extraInstructions ? `\n${input.extraInstructions}\n` : ""}
ELEMENTOS EXTRAÍDOS RELACIONADOS:
${relatedDigest || "(ninguno)"}

PASAJES DE LA TRANSCRIPCIÓN (con marcadores para citar):
${excerpt || "(sin pasajes: indica que no hay material suficiente)"}
${slides ? `\nPÁGINAS DE LAS DIAPOSITIVAS RELACIONADAS:\n${slides}` : ""}`;
  const { data, usage } = await createStructured<SectionDraft>(config, {
    model: config.models.notes,
    system: sectionSystem(input.language, input.dominant),
    user,
    schema: sectionSchema,
    reasoningEffort: "low",
    maxOutputTokens: overviewOnly ? 1200 : 7000,
  });
  await usageTotal(ctx, config.models.notes, usage);
  return data;
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

export interface SummariesParams {
  language: DocumentLanguage | "auto";
  modes?: SummaryMode[];
}

function notesAsText(content: StudyDocumentContent): string {
  return content.sections.map((s) => `${"#".repeat(s.level + 1)} ${s.heading}\n${s.markdown}`).join("\n\n");
}

async function summariesHandler(ctx: JobContext): Promise<Record<string, unknown>> {
  const sessionId = ctx.job.sessionId;
  if (!sessionId) ctx.fail("El trabajo no tiene clase asociada.");
  const params = ctx.job.params as unknown as SummariesParams;
  const { config } = ctx;
  await ctx.setStage(STAGES.prepare);
  const notes = await getCurrentContent(ctx.db, ctx.job.userId, sessionId, "notes");
  if (!notes) ctx.fail("Genera primero los apuntes completos: los resúmenes se derivan de ellos.");
  const segments = await loadSourceSegments(ctx.db, ctx.job.userId, sessionId);
  const transcript = consolidate(segments);
  const lecture = await loadLectureContext(ctx, sessionId);
  const language = resolveLanguage(params.language ?? "auto", transcript.dominantLanguage);
  const modes: SummaryMode[] = params.modes?.length
    ? params.modes
    : ["summary_quick", "summary_full", "summary_last_minute"];
  const notesText = notesAsText(notes.content).slice(0, 160_000);
  const results: Record<string, unknown> = {};
  let i = 0;
  for (const mode of modes) {
    i++;
    await assertNotCancelled(ctx);
    await ctx.setStage(`Redactando ${SUMMARY_SPECS[mode].title.toLowerCase()} (${i}/${modes.length})`);
    const saved = await ctx.step(`summary:${mode}`, async () => {
      const { data, usage } = await createStructured<{ sections: { heading: string; markdown: string }[] }>(config, {
        model: config.models.notes,
        system: summarySystem(mode, language, transcript.dominantLanguage),
        user: `${lecture.subjectName ? `Asignatura: ${lecture.subjectName}. ` : ""}Clase: "${lecture.title}".\n\nAPUNTES COMPLETOS:\n${notesText}`,
        schema: summarySchema,
        reasoningEffort: "low",
        maxOutputTokens: 5000,
      });
      await usageTotal(ctx, config.models.notes, usage);
      const sections: DocumentSection[] = data.sections.map((s, idx) => {
        const { markdown, refs } = normalizeRefs(s.markdown, transcript.segments);
        return { id: `s${idx + 1}`, heading: s.heading, level: 1, markdown, refs, ambiguities: [] };
      });
      const content: StudyDocumentContent = {
        version: 1,
        title: `${SUMMARY_SPECS[mode].title} · ${notes.content.title}`,
        language,
        sections,
        meta: {
          generatedAt: Date.now(),
          model: config.models.notes,
          uncovered: [],
          gaps: [],
          wordCount: sections.reduce((n, s) => n + countWords(s.markdown), 0),
          sourceSegments: notes.content.meta.sourceSegments,
          attachments: [],
        },
      };
      return saveDocumentVersion(ctx.db, {
        userId: ctx.job.userId,
        sessionId,
        kind: mode,
        content,
        origin: "ai",
        jobId: ctx.job.id,
      });
    });
    results[mode] = saved;
  }
  await ctx.setStage(STAGES.done);
  return results;
}

// ---------------------------------------------------------------------------
// Exam questions
// ---------------------------------------------------------------------------

export interface ExamParams {
  language: DocumentLanguage | "auto";
  counts: Partial<Record<GeneratedQuestion["qtype"], number>>;
  /** Replace existing questions of the requested types. */
  replace?: boolean;
}

function refsFromString(raw: string, segments: SourceSegment[]): SourceRef[] {
  const { refs } = normalizeRefs(raw, segments);
  return refs.map((r) => ({
    kind: "transcript",
    seqFrom: r.seqFrom,
    seqTo: r.seqTo,
    startMs: r.startMs,
    endMs: r.endMs,
  }));
}

/** Canonicalise citation tokens inside free text (prompt, answer, rubric). */
function canon(text: string | undefined | null, segments: SourceSegment[]): string {
  return text ? normalizeRefs(text, segments).markdown.trim() : "";
}

async function examHandler(ctx: JobContext): Promise<Record<string, unknown>> {
  const sessionId = ctx.job.sessionId;
  if (!sessionId) ctx.fail("El trabajo no tiene clase asociada.");
  const params = ctx.job.params as unknown as ExamParams;
  const { config } = ctx;
  await ctx.setStage(STAGES.prepare);
  const notes = await getCurrentContent(ctx.db, ctx.job.userId, sessionId, "notes");
  const segments = await loadSourceSegments(ctx.db, ctx.job.userId, sessionId);
  const transcript = consolidate(segments);
  if (!transcript.blocks.length) ctx.fail("La clase no tiene transcripción suficiente.");
  const lecture = await loadLectureContext(ctx, sessionId);
  const language = resolveLanguage(params.language ?? "auto", transcript.dominantLanguage);
  const [sessionRow] = await ctx.db
    .select({ subjectId: lectureSessions.subjectId })
    .from(lectureSessions)
    .where(eq(lectureSessions.id, sessionId))
    .limit(1);

  const material = notes
    ? `APUNTES COMPLETOS:\n${notesAsText(notes.content).slice(0, 120_000)}\n\nPASAJES DE LA TRANSCRIPCIÓN:\n${renderRanges(transcript.segments, transcript.blocks, 20_000)}`
    : `TRANSCRIPCIÓN:\n${renderRanges(transcript.segments, transcript.blocks, 45_000)}`;

  const requested = (Object.entries(params.counts) as [GeneratedQuestion["qtype"], number][]).filter(([, n]) => n > 0);
  if (!requested.length) ctx.fail("No se pidió ningún tipo de pregunta.");

  if (params.replace) {
    await ctx.step("clear", async () => {
      for (const [qtype] of requested) {
        await ctx.db
          .delete(examQuestions)
          .where(
            and(
              eq(examQuestions.sessionId, sessionId),
              eq(examQuestions.userId, ctx.job.userId),
              eq(examQuestions.qtype, qtype),
            ),
          );
      }
      return { cleared: requested.map(([q]) => q) };
    });
  }

  let created = 0;
  let i = 0;
  for (const [qtype, count] of requested) {
    i++;
    await assertNotCancelled(ctx);
    await ctx.setStage(`Generando preguntas (${i}/${requested.length})`);
    const n = Math.min(40, count);
    const batches = Math.ceil(n / 12);
    for (let b = 0; b < batches; b++) {
      const want = Math.min(12, n - b * 12);
      const inserted = await ctx.step(`questions:${qtype}:${b}`, async () => {
        const levelHint =
          qtype === "oral"
            ? " Reparte las preguntas orales entre los niveles 1 a 4 (aprox. la misma cantidad por nivel)."
            : "";
        const { data, usage } = await createStructured<{ questions: GeneratedQuestion[] }>(config, {
          model: config.models.notes,
          system: questionsSystem(language, transcript.dominantLanguage),
          user: `${lecture.subjectName ? `Asignatura: ${lecture.subjectName}. ` : ""}Clase: "${lecture.title}".
Genera exactamente ${want} preguntas de tipo "${qtype}".${levelHint}${b > 0 ? " Evita repetir conceptos ya cubiertos en lotes anteriores; elige otros temas de la clase." : ""}

${material}`,
          schema: questionsSchema,
          reasoningEffort: "low",
          maxOutputTokens: 9000,
        });
        await usageTotal(ctx, config.models.notes, usage);
        const now = Date.now();
        const rows = data.questions
          .filter((q) => q.prompt.trim() && q.answer.trim())
          .filter((q) => q.qtype !== "mcq" || (q.options.length === 4 && q.correctOption >= 0 && q.correctOption < 4))
          .map((q) => ({
            id: newId(),
            userId: ctx.job.userId,
            sessionId,
            subjectId: sessionRow?.subjectId ?? null,
            qtype,
            level: qtype === "oral" ? Math.min(4, Math.max(1, Math.round(q.level ?? 1))) : null,
            concept: q.concept.trim().slice(0, 200),
            conceptKey: conceptKey(q.concept),
            prompt: canon(q.prompt, transcript.segments),
            options: qtype === "mcq" ? q.options : null,
            correctOption: qtype === "mcq" ? q.correctOption : null,
            answer: canon(q.answer, transcript.segments),
            explanation: canon(q.explanation, transcript.segments) || null,
            rubric: q.rubric?.length ? q.rubric.map((r) => canon(r, transcript.segments)) : null,
            // Every span cited anywhere in the question becomes a verifiable source.
            sourceRefs: refsFromString(
              [q.refs ?? "", q.prompt, q.answer, q.explanation ?? "", ...(q.rubric ?? [])].join("\n"),
              transcript.segments,
            ),
            extendsSyllabus: Boolean(q.extendsSyllabus),
            createdAt: now,
          }));
        for (const batch of chunkForInsert(rows, 17)) await ctx.db.insert(examQuestions).values(batch);
        return rows.length;
      });
      created += inserted;
    }
  }
  await ctx.setStage(STAGES.done);
  return { created };
}

registerJobHandler("notes", notesHandler);
registerJobHandler("summaries", summariesHandler);
registerJobHandler("exam", examHandler);

export { describeRefs, type TranscriptRef };
