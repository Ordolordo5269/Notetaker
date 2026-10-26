// Retrieval over a lecture's sources (transcript windows, notes sections and
// attachment pages) for the chat: hybrid FTS5 + embedding search fused with
// reciprocal rank fusion. The index is maintained lazily: ensureIndex() fills
// in missing transcript windows and embeddings before a question is answered.
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { chunkForInsert } from "@/lib/db";
import { documentSources, lectureAttachments } from "@/lib/db/schema";
import type { AppConfig } from "@/lib/env";
import { newId } from "@/lib/ids";
import { createEmbeddings } from "@/lib/openai/client";
import { recordUsage } from "@/lib/cost/usage";
import { loadSourceSegments } from "@/lib/data/documents";
import { toFtsQuery } from "@/lib/data/search";
import { estimateTokens } from "@/lib/cost/pricing";

export interface RetrievedSource {
  id: string;
  sourceType: "transcript" | "attachment" | "notes";
  text: string;
  seqFrom: number | null;
  seqTo: number | null;
  startMs: number | null;
  endMs: number | null;
  attachmentId: string | null;
  fileName: string | null;
  pageNumber: number | null;
  sectionKey: string | null;
  score: number;
}

const WINDOW_TARGET_TOKENS = 220;
const WINDOW_OVERLAP_SEGMENTS = 1;
const EMBED_BATCH = 64;
const EMBED_MAX_CHARS = 6000;

/** Transcript windows: a few consecutive segments (~1 minute) with one segment of overlap. */
async function rebuildTranscriptWindows(db: Db, userId: string, sessionId: string): Promise<number> {
  const segments = (await loadSourceSegments(db, userId, sessionId)).filter(
    (s) => s.status === "final" && s.text.trim(),
  );
  await db
    .delete(documentSources)
    .where(
      and(
        eq(documentSources.sessionId, sessionId),
        eq(documentSources.userId, userId),
        eq(documentSources.sourceType, "transcript"),
      ),
    );
  const rows: (typeof documentSources.$inferInsert)[] = [];
  let current: typeof segments = [];
  let tokens = 0;
  const now = Date.now();
  const flush = () => {
    if (!current.length) return;
    rows.push({
      id: newId(),
      userId,
      sessionId,
      sourceType: "transcript",
      attachmentId: null,
      pageNumber: null,
      seqFrom: current[0]!.seq,
      seqTo: current[current.length - 1]!.seq,
      startMs: current[0]!.startMs,
      endMs: current[current.length - 1]!.endMs,
      sectionKey: null,
      text: current.map((s) => s.text.trim()).join(" "),
      embedding: null,
      embeddingModel: null,
      createdAt: now,
    });
  };
  for (const s of segments) {
    const t = estimateTokens(s.text);
    if (tokens + t > WINDOW_TARGET_TOKENS && current.length) {
      flush();
      current = current.slice(-WINDOW_OVERLAP_SEGMENTS);
      tokens = current.reduce((n, x) => n + estimateTokens(x.text), 0);
    }
    current.push(s);
    tokens += t;
  }
  flush();
  for (const batch of chunkForInsert(rows, 15)) await db.insert(documentSources).values(batch);
  return rows.length;
}

/**
 * Make sure the session has transcript windows and that every source row
 * carries an embedding. Cheap when nothing changed.
 */
export async function ensureIndex(db: Db, config: AppConfig, userId: string, sessionId: string): Promise<void> {
  const [counts] = await db
    .select({
      transcript: sql<number>`sum(case when ${documentSources.sourceType} = 'transcript' then 1 else 0 end)`,
      missing: sql<number>`sum(case when ${documentSources.embedding} is null then 1 else 0 end)`,
    })
    .from(documentSources)
    .where(and(eq(documentSources.sessionId, sessionId), eq(documentSources.userId, userId)));
  if (!counts?.transcript) await rebuildTranscriptWindows(db, userId, sessionId);
  const pending = await db
    .select({ id: documentSources.id, text: documentSources.text })
    .from(documentSources)
    .where(
      and(
        eq(documentSources.sessionId, sessionId),
        eq(documentSources.userId, userId),
        isNull(documentSources.embedding),
      ),
    )
    .limit(600);
  for (let i = 0; i < pending.length; i += EMBED_BATCH) {
    const batch = pending.slice(i, i + EMBED_BATCH);
    const { vectors, usage } = await createEmbeddings(
      config,
      batch.map((b) => b.text.slice(0, EMBED_MAX_CHARS)),
    );
    await recordUsage(db, {
      userId,
      sessionId,
      kind: "embedding",
      model: config.models.embedding,
      inputTokens: usage.inputTokens,
    });
    const statements = batch.map((b, idx) =>
      db
        .update(documentSources)
        .set({ embedding: Buffer.from(vectors[idx]!.buffer), embeddingModel: config.models.embedding })
        .where(eq(documentSources.id, b.id)),
    );
    await db.batch(statements as [(typeof statements)[number], ...typeof statements]);
  }
}

/** Forget transcript windows (call after the transcript changed). */
export async function invalidateTranscriptIndex(db: Db, userId: string, sessionId: string) {
  await db
    .delete(documentSources)
    .where(
      and(
        eq(documentSources.sessionId, sessionId),
        eq(documentSources.userId, userId),
        eq(documentSources.sourceType, "transcript"),
      ),
    );
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function toFloat32(buf: Buffer | Uint8Array): Float32Array {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const aligned = u8.byteOffset % 4 === 0 ? u8 : new Uint8Array(u8);
  return new Float32Array(aligned.buffer, aligned.byteOffset, Math.floor(aligned.byteLength / 4));
}

const PAGE_RE = /\b(?:diapositiva|slide|p[aá]gina|page|p\.)\s*(\d{1,3})\b/i;

export interface RetrievalOptions {
  k?: number;
  /** Restrict to these source types. */
  types?: ("transcript" | "attachment" | "notes")[];
}

export async function retrieve(
  db: Db,
  config: AppConfig,
  userId: string,
  sessionId: string,
  query: string,
  opts: RetrievalOptions = {},
): Promise<RetrievedSource[]> {
  const k = opts.k ?? 10;
  const types = opts.types ?? ["transcript", "attachment", "notes"];
  const where = and(
    eq(documentSources.sessionId, sessionId),
    eq(documentSources.userId, userId),
    inArray(documentSources.sourceType, types),
  );

  // Lexical candidates.
  const fts = toFtsQuery(query);
  const lexical = fts
    ? await db.all<{ id: string; rank: number }>(sql`
        SELECT ds.id AS id, bm25(document_sources_fts) AS rank
        FROM document_sources_fts
        JOIN document_sources ds ON ds.rowid = document_sources_fts.rowid
        WHERE document_sources_fts MATCH ${fts}
          AND ds.session_id = ${sessionId} AND ds.user_id = ${userId}
          AND ds.source_type IN (${sql.join(
            types.map((t) => sql`${t}`),
            sql`, `,
          )})
        ORDER BY rank LIMIT 30
      `)
    : [];

  // Semantic candidates (all of the session's vectors fit in memory).
  let semantic: { id: string; score: number }[] = [];
  try {
    const { vectors } = await createEmbeddings(config, [query.slice(0, 2000)]);
    const q = vectors[0];
    if (q) {
      const rows = await db
        .select({ id: documentSources.id, embedding: documentSources.embedding })
        .from(documentSources)
        .where(where);
      semantic = rows
        .filter((r) => r.embedding)
        .map((r) => ({ id: r.id, score: cosine(q, toFloat32(r.embedding!)) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 30);
    }
  } catch {
    /* embeddings unavailable: lexical only */
  }

  // Reciprocal rank fusion.
  const fused = new Map<string, number>();
  lexical.forEach((r, i) => fused.set(r.id, (fused.get(r.id) ?? 0) + 1 / (60 + i)));
  semantic.forEach((r, i) => fused.set(r.id, (fused.get(r.id) ?? 0) + 1 / (60 + i)));

  // Explicit slide/page references always come along.
  const pageMatch = PAGE_RE.exec(query);
  const forcedIds: string[] = [];
  if (pageMatch) {
    const page = Number(pageMatch[1]);
    const pages = await db
      .select({ id: documentSources.id })
      .from(documentSources)
      .where(and(where, eq(documentSources.sourceType, "attachment"), eq(documentSources.pageNumber, page)));
    for (const p of pages) {
      forcedIds.push(p.id);
      fused.set(p.id, (fused.get(p.id) ?? 0) + 1);
    }
  }

  const ids = [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([id]) => id);
  if (!ids.length) return [];
  const rows = await db
    .select({
      id: documentSources.id,
      sourceType: documentSources.sourceType,
      text: documentSources.text,
      seqFrom: documentSources.seqFrom,
      seqTo: documentSources.seqTo,
      startMs: documentSources.startMs,
      endMs: documentSources.endMs,
      attachmentId: documentSources.attachmentId,
      pageNumber: documentSources.pageNumber,
      sectionKey: documentSources.sectionKey,
      fileName: lectureAttachments.fileName,
    })
    .from(documentSources)
    .leftJoin(lectureAttachments, eq(lectureAttachments.id, documentSources.attachmentId))
    .where(inArray(documentSources.id, ids));
  return rows.map((r) => ({ ...r, score: fused.get(r.id) ?? 0 })).sort((a, b) => b.score - a.score);
}
