// Drizzle table definitions mirroring migrations/*.sql.
// The SQL migrations are the source of truth (they also hold triggers, FTS
// tables and CHECK constraints); tests/unit/schema.test.ts verifies that the
// columns declared here exist in the migrated database.
import { sqliteTable, text, integer, real, blob, primaryKey } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const authSessions = sqliteTable("auth_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
  lastUsedAt: integer("last_used_at").notNull(),
  userAgent: text("user_agent"),
  createdAt: integer("created_at").notNull(),
});

export const authAttempts = sqliteTable("auth_attempts", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStart: integer("window_start").notNull(),
});

export const profiles = sqliteTable("profiles", {
  userId: text("user_id").primaryKey(),
  notesLanguage: text("notes_language", { enum: ["auto", "es", "en", "bilingual"] }).notNull(),
  removeFillers: integer("remove_fillers", { mode: "boolean" }).notNull(),
  transcriptionDelay: text("transcription_delay", {
    enum: ["minimal", "low", "medium", "high", "xhigh"],
  }).notNull(),
  /** Live WebSocket transcription or per-turn HTTP transcription (cheaper). */
  transcriptionMode: text("transcription_mode", { enum: ["realtime", "turns"] })
    .notNull()
    .default("realtime"),
  /** Which models draft the notes: "max" = notes model everywhere, "economy" = fast model for drafts. */
  notesQuality: text("notes_quality", { enum: ["max", "economy"] })
    .notNull()
    .default("max"),
  audioReviewEnabled: integer("audio_review_enabled", { mode: "boolean" }).notNull(),
  audioRetentionDays: integer("audio_retention_days"),
  monthlyBudgetUsd: real("monthly_budget_usd"),
  jobBudgetUsd: real("job_budget_usd"),
  recordingNoticeAckAt: integer("recording_notice_ack_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const SUBJECT_COLORS = ["green", "blue", "amber", "rose", "violet", "slate", "teal", "orange"] as const;
export type SubjectColor = (typeof SUBJECT_COLORS)[number];

export const subjects = sqliteTable("subjects", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  color: text("color", { enum: SUBJECT_COLORS }).notNull(),
  keywords: text("keywords", { mode: "json" }).$type<string[]>().notNull(),
  description: text("description"),
  archivedAt: integer("archived_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const SESSION_STATUSES = [
  "created",
  "recording",
  "paused",
  "recovering",
  "finalizing",
  "ready",
  "failed",
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const PROCESSING_STATUSES = ["idle", "queued", "processing", "completed", "failed"] as const;
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export const lectureSessions = sqliteTable("lecture_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  subjectId: text("subject_id"),
  title: text("title").notNull(),
  status: text("status", { enum: SESSION_STATUSES }).notNull(),
  processingStatus: text("processing_status", { enum: PROCESSING_STATUSES }).notNull(),
  startedAt: integer("started_at"),
  endedAt: integer("ended_at"),
  durationMs: integer("duration_ms").notNull(),
  lastHeartbeatAt: integer("last_heartbeat_at"),
  audioMime: text("audio_mime"),
  transcriptionMode: text("transcription_mode", { enum: ["realtime", "turns"] }),
  /** "live" = recorded in the browser; "import" = uploaded audio file. */
  origin: text("origin", { enum: ["live", "import"] })
    .notNull()
    .default("live"),
  sourceFileName: text("source_file_name"),
  keywords: text("keywords", { mode: "json" }).$type<string[]>().notNull(),
  languages: text("languages", { mode: "json" }).$type<string[]>().notNull(),
  failureReason: text("failure_reason"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const audioChunks = sqliteTable("audio_chunks", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  sessionId: text("session_id").notNull(),
  seq: integer("seq").notNull(),
  startMs: integer("start_ms").notNull(),
  endMs: integer("end_ms").notNull(),
  durationMs: integer("duration_ms").notNull(),
  overlapMs: integer("overlap_ms").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  r2Key: text("r2_key").notNull(),
  partial: integer("partial", { mode: "boolean" }).notNull(),
  createdAt: integer("created_at").notNull(),
});

export const SEGMENT_SOURCES = ["realtime", "turns", "recovery", "review"] as const;
export type SegmentSource = (typeof SEGMENT_SOURCES)[number];
export const SEGMENT_LANGUAGES = ["es", "en", "mixed", "und"] as const;
export type SegmentLanguage = (typeof SEGMENT_LANGUAGES)[number];

export const transcriptSegments = sqliteTable("transcript_segments", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  sessionId: text("session_id").notNull(),
  seq: integer("seq").notNull(),
  providerItemId: text("provider_item_id"),
  text: text("text").notNull(),
  status: text("status", { enum: ["final", "failed", "gap"] }).notNull(),
  source: text("source", { enum: SEGMENT_SOURCES }).notNull(),
  startMs: integer("start_ms").notNull(),
  endMs: integer("end_ms").notNull(),
  language: text("language", { enum: SEGMENT_LANGUAGES }).notNull(),
  languageSource: text("language_source", { enum: ["heuristic", "model"] }).notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const MARKER_TYPES = ["important", "exam", "confused", "note"] as const;
export type MarkerType = (typeof MARKER_TYPES)[number];

export const lectureMarkers = sqliteTable("lecture_markers", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  sessionId: text("session_id").notNull(),
  type: text("type", { enum: MARKER_TYPES }).notNull(),
  atMs: integer("at_ms").notNull(),
  note: text("note"),
  createdAt: integer("created_at").notNull(),
});

export const ATTACHMENT_KINDS = ["pdf", "docx", "pptx"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const lectureAttachments = sqliteTable("lecture_attachments", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  sessionId: text("session_id").notNull(),
  fileName: text("file_name").notNull(),
  kind: text("kind", { enum: ATTACHMENT_KINDS }).notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  r2Key: text("r2_key").notNull(),
  pageCount: integer("page_count"),
  extractionStatus: text("extraction_status", {
    enum: ["pending", "processing", "ready", "needs_ocr", "failed"],
  }).notNull(),
  extractionError: text("extraction_error"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const DOCUMENT_KINDS = ["notes", "summary_quick", "summary_full", "summary_last_minute"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DOCUMENT_LANGUAGES = ["es", "en", "bilingual"] as const;
export type DocumentLanguage = (typeof DOCUMENT_LANGUAGES)[number];

export const studyDocuments = sqliteTable("study_documents", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  sessionId: text("session_id").notNull(),
  kind: text("kind", { enum: DOCUMENT_KINDS }).notNull(),
  language: text("language", { enum: DOCUMENT_LANGUAGES }).notNull(),
  title: text("title").notNull(),
  currentVersionId: text("current_version_id"),
  searchText: text("search_text").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const VERSION_ORIGINS = ["ai", "ai_section", "user", "restore"] as const;
export type VersionOrigin = (typeof VERSION_ORIGINS)[number];

export const studyDocumentVersions = sqliteTable("study_document_versions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  documentId: text("document_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  origin: text("origin", { enum: VERSION_ORIGINS }).notNull(),
  content: text("content").notNull(),
  wordCount: integer("word_count").notNull(),
  jobId: text("job_id"),
  label: text("label"),
  createdAt: integer("created_at").notNull(),
});

export const documentSources = sqliteTable("document_sources", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  sessionId: text("session_id").notNull(),
  sourceType: text("source_type", { enum: ["transcript", "attachment", "notes"] }).notNull(),
  attachmentId: text("attachment_id"),
  pageNumber: integer("page_number"),
  seqFrom: integer("seq_from"),
  seqTo: integer("seq_to"),
  startMs: integer("start_ms"),
  endMs: integer("end_ms"),
  sectionKey: text("section_key"),
  text: text("text").notNull(),
  embedding: blob("embedding", { mode: "buffer" }),
  embeddingModel: text("embedding_model"),
  createdAt: integer("created_at").notNull(),
});

export const QUESTION_TYPES = ["mcq", "short", "essay", "oral", "case"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const examQuestions = sqliteTable("exam_questions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  sessionId: text("session_id").notNull(),
  subjectId: text("subject_id"),
  qtype: text("qtype", { enum: QUESTION_TYPES }).notNull(),
  level: integer("level"),
  concept: text("concept").notNull(),
  conceptKey: text("concept_key").notNull(),
  prompt: text("prompt").notNull(),
  options: text("options", { mode: "json" }).$type<string[] | null>(),
  correctOption: integer("correct_option"),
  answer: text("answer").notNull(),
  explanation: text("explanation"),
  rubric: text("rubric", { mode: "json" }).$type<string[] | null>(),
  sourceRefs: text("source_refs", { mode: "json" }).$type<SourceRef[]>().notNull(),
  extendsSyllabus: integer("extends_syllabus", { mode: "boolean" }).notNull(),
  createdAt: integer("created_at").notNull(),
});

export const examAttempts = sqliteTable("exam_attempts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  questionId: text("question_id").notNull(),
  sessionId: text("session_id"),
  subjectId: text("subject_id"),
  answer: text("answer"),
  selectedOption: integer("selected_option"),
  score: real("score").notNull(),
  verdict: text("verdict", { enum: ["correct", "partial", "incorrect"] }).notNull(),
  feedback: text("feedback"),
  createdAt: integer("created_at").notNull(),
});

export const CARD_TYPES = ["definition", "qa", "article", "term", "comparison", "exception"] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const flashcards = sqliteTable("flashcards", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  sessionId: text("session_id"),
  subjectId: text("subject_id"),
  cardType: text("card_type", { enum: CARD_TYPES }).notNull(),
  front: text("front").notNull(),
  back: text("back").notNull(),
  conceptKey: text("concept_key").notNull(),
  sourceRefs: text("source_refs", { mode: "json" }).$type<SourceRef[]>().notNull(),
  ease: real("ease").notNull(),
  intervalDays: real("interval_days").notNull(),
  repetitions: integer("repetitions").notNull(),
  lapses: integer("lapses").notNull(),
  dueAt: integer("due_at").notNull(),
  lastReviewedAt: integer("last_reviewed_at"),
  suspended: integer("suspended", { mode: "boolean" }).notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const REVIEW_GRADES = ["again", "hard", "good", "easy"] as const;
export type ReviewGrade = (typeof REVIEW_GRADES)[number];

export const flashcardReviews = sqliteTable("flashcard_reviews", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  flashcardId: text("flashcard_id").notNull(),
  grade: text("grade", { enum: REVIEW_GRADES }).notNull(),
  prevIntervalDays: real("prev_interval_days").notNull(),
  nextIntervalDays: real("next_interval_days").notNull(),
  prevEase: real("prev_ease").notNull(),
  nextEase: real("next_ease").notNull(),
  reviewedAt: integer("reviewed_at").notNull(),
});

export const chatConversations = sqliteTable("chat_conversations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  sessionId: text("session_id").notNull(),
  title: text("title").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  conversationId: text("conversation_id").notNull(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  payload: text("payload", { mode: "json" }).$type<unknown>(),
  createdAt: integer("created_at").notNull(),
});

export const JOB_TYPES = [
  "notes",
  "summaries",
  "exam",
  "flashcards",
  "attachment",
  "index",
  "section",
  "recovery_transcription",
] as const;
export type JobType = (typeof JOB_TYPES)[number];
export const JOB_STATUSES = ["queued", "running", "completed", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const processingJobs = sqliteTable("processing_jobs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  sessionId: text("session_id"),
  jobType: text("job_type", { enum: JOB_TYPES }).notNull(),
  status: text("status", { enum: JOB_STATUSES }).notNull(),
  stage: text("stage"),
  dedupeKey: text("dedupe_key").notNull(),
  params: text("params", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  result: text("result", { mode: "json" }).$type<Record<string, unknown> | null>(),
  error: text("error"),
  estimatedCostUsd: real("estimated_cost_usd"),
  costUsd: real("cost_usd").notNull(),
  runner: text("runner", { enum: ["workflow", "local"] }),
  workflowInstanceId: text("workflow_instance_id"),
  attempt: integer("attempt").notNull(),
  startedAt: integer("started_at"),
  finishedAt: integer("finished_at"),
  heartbeatAt: integer("heartbeat_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const jobSteps = sqliteTable(
  "job_steps",
  {
    jobId: text("job_id").notNull(),
    name: text("name").notNull(),
    output: text("output").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.name] })],
);

export const usageEvents = sqliteTable("usage_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  sessionId: text("session_id"),
  jobId: text("job_id"),
  kind: text("kind", { enum: ["live_transcription", "file_transcription", "llm", "embedding"] }).notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  cachedInputTokens: integer("cached_input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  audioSeconds: real("audio_seconds").notNull(),
  costUsd: real("cost_usd").notNull(),
  createdAt: integer("created_at").notNull(),
});

/** A verifiable pointer back to the lecture material an item was derived from. */
export type SourceRef =
  | { kind: "transcript"; seqFrom: number; seqTo: number; startMs: number; endMs: number }
  | { kind: "attachment"; attachmentId: string; page: number; fileName?: string };
