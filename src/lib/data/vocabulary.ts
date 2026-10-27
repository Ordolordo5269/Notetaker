// Vocabulary the app learns from each class: the terms and norms the notes
// pipeline extracted become transcription keywords for the lecture and for its
// subject, so the next class of the same subject is transcribed with the right
// names ("Geneva Conventions", not "genuine convention"). The student can edit
// the list in the subject dialog at any time; their own entries always come first.
import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { lectureSessions, subjects } from "@/lib/db/schema";

export const SUBJECT_VOCABULARY_CAP = 60;
export const LECTURE_VOCABULARY_CAP = 40;

const STOPWORDS = new Set([
  "el",
  "la",
  "los",
  "las",
  "un",
  "una",
  "de",
  "del",
  "y",
  "o",
  "en",
  "que",
  "por",
  "para",
  "con",
  "sin",
  "the",
  "a",
  "an",
  "of",
  "and",
  "or",
  "in",
  "on",
  "to",
  "for",
  "with",
  "is",
  "are",
  "this",
  "that",
]);

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Keeps short, meaningful terms: 2–60 characters, at most 8 words, not just stopwords or numbers. */
export function cleanTerm(raw: string): string | null {
  const term = raw
    .replace(/[<>\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.:;,]+$/, "");
  if (term.length < 2 || term.length > 60) return null;
  const words = normalize(term).split(" ").filter(Boolean);
  if (!words.length || words.length > 8) return null;
  if (words.every((w) => STOPWORDS.has(w) || /^\d+$/.test(w))) return null;
  if (!/[a-zA-ZÀ-ɏ]/.test(term)) return null;
  return term;
}

/** `existing` first (the user's own list), then new terms, deduplicated ignoring case and accents. */
export function mergeVocabulary(existing: readonly string[], learned: readonly string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...existing, ...learned]) {
    const term = cleanTerm(raw);
    if (!term) continue;
    const key = normalize(term);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= cap) break;
  }
  return out;
}

/** Stores learned terms on the lecture and on its subject (if any). Returns how many were new for the subject. */
export async function learnVocabulary(db: Db, userId: string, sessionId: string, terms: readonly string[]) {
  const [lecture] = await db
    .select({ subjectId: lectureSessions.subjectId, keywords: lectureSessions.keywords })
    .from(lectureSessions)
    .where(and(eq(lectureSessions.id, sessionId), eq(lectureSessions.userId, userId)))
    .limit(1);
  if (!lecture) return { lectureTerms: 0, subjectAdded: 0 };
  const now = Date.now();
  const lectureTerms = mergeVocabulary(lecture.keywords ?? [], terms, LECTURE_VOCABULARY_CAP);
  await db
    .update(lectureSessions)
    .set({ keywords: lectureTerms, updatedAt: now })
    .where(and(eq(lectureSessions.id, sessionId), eq(lectureSessions.userId, userId)));
  let subjectAdded = 0;
  if (lecture.subjectId) {
    const [subject] = await db
      .select({ keywords: subjects.keywords })
      .from(subjects)
      .where(and(eq(subjects.id, lecture.subjectId), eq(subjects.userId, userId)))
      .limit(1);
    if (subject) {
      const merged = mergeVocabulary(subject.keywords ?? [], terms, SUBJECT_VOCABULARY_CAP);
      subjectAdded = Math.max(0, merged.length - (subject.keywords ?? []).length);
      if (subjectAdded > 0) {
        await db
          .update(subjects)
          .set({ keywords: merged, updatedAt: now })
          .where(and(eq(subjects.id, lecture.subjectId), eq(subjects.userId, userId)));
      }
    }
  }
  return { lectureTerms: lectureTerms.length, subjectAdded };
}
