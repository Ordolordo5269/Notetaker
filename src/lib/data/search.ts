import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db";

export interface SearchHit {
  kind: "lecture" | "transcript" | "document";
  sessionId: string;
  lectureTitle: string;
  subjectName: string | null;
  subjectColor: string | null;
  snippet: string;
  /** Transcript hits: approximate position on the audio timeline. */
  startMs: number | null;
  seq: number | null;
  documentKind: string | null;
  createdAt: number;
}

/** Turn free text into a safe FTS5 query: quoted terms with prefix matching. */
export function toFtsQuery(input: string): string | null {
  const terms = input
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2)
    .slice(0, 8);
  if (!terms.length) return null;
  return terms.map((t) => `"${t.replace(/"/g, "")}"*`).join(" ");
}

export async function searchAll(db: Db, userId: string, query: string, limit = 40): Promise<SearchHit[]> {
  const fts = toFtsQuery(query);
  if (!fts) return [];
  const like = `%${query.trim().toLowerCase()}%`;
  const rows = await db.all<SearchHit>(sql`
    SELECT * FROM (
      SELECT 'lecture' AS kind, l.id AS sessionId, l.title AS lectureTitle, s.name AS subjectName, s.color AS subjectColor,
             l.title AS snippet, NULL AS startMs, NULL AS seq, NULL AS documentKind, l.created_at AS createdAt, 0 AS rank
      FROM lecture_sessions l LEFT JOIN subjects s ON s.id = l.subject_id
      WHERE l.user_id = ${userId} AND lower(l.title) LIKE ${like}
      UNION ALL
      SELECT 'transcript', l.id, l.title, s.name, s.color,
             snippet(transcript_segments_fts, 0, '[[', ']]', '…', 18), t.start_ms, t.seq, NULL, l.created_at,
             bm25(transcript_segments_fts)
      FROM transcript_segments_fts
      JOIN transcript_segments t ON t.rowid = transcript_segments_fts.rowid
      JOIN lecture_sessions l ON l.id = t.session_id
      LEFT JOIN subjects s ON s.id = l.subject_id
      WHERE transcript_segments_fts MATCH ${fts} AND t.user_id = ${userId} AND t.status = 'final'
      UNION ALL
      SELECT 'document', l.id, l.title, s.name, s.color,
             snippet(study_documents_fts, 1, '[[', ']]', '…', 18), NULL, NULL, d.kind, l.created_at,
             bm25(study_documents_fts)
      FROM study_documents_fts
      JOIN study_documents d ON d.rowid = study_documents_fts.rowid
      JOIN lecture_sessions l ON l.id = d.session_id
      LEFT JOIN subjects s ON s.id = l.subject_id
      WHERE study_documents_fts MATCH ${fts} AND d.user_id = ${userId}
    )
    ORDER BY rank, createdAt DESC
    LIMIT ${limit}
  `);
  return rows;
}
