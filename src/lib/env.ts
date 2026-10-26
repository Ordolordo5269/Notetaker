// Typed application configuration derived from the Worker environment.
// Shared by Next.js route handlers and the Workflow worker, so it must not
// import Next-only modules.

export interface ModelConfig {
  /** Long-form drafting, outline, review, exam generation. */
  notes: string;
  /** Cheap extraction, grading, flashcards, query rewriting. */
  fast: string;
  /** Answers in the lecture chat. */
  chat: string;
  /** Live microphone transcription (Realtime API). */
  live: string;
  /** Recorded audio / committed turns transcription. */
  file: string;
  embedding: string;
}

export interface AppConfig {
  appEnv: string;
  openaiApiKey: string | null;
  openaiBaseUrl: string;
  /** Credential injected by an egress proxy: send no Authorization header. */
  openaiProxyAuth: boolean;
  models: ModelConfig;
  allowedSignupEmails: string[];
}

export function readConfig(env: CloudflareEnv): AppConfig {
  const vars = env as unknown as Record<string, string | undefined>;
  return {
    appEnv: vars.APP_ENV ?? "development",
    openaiApiKey: env.OPENAI_API_KEY?.trim() || null,
    openaiBaseUrl: (env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, ""),
    openaiProxyAuth: env.OPENAI_PROXY_AUTH === "1",
    models: {
      notes: vars.OPENAI_NOTES_MODEL || "gpt-6.1-sol",
      fast: vars.OPENAI_FAST_MODEL || "gpt-6-luna",
      chat: vars.OPENAI_CHAT_MODEL || "gpt-6.1-sol",
      live: vars.OPENAI_LIVE_TRANSCRIBE_MODEL || "gpt-live-transcribe",
      file: vars.OPENAI_FILE_TRANSCRIBE_MODEL || "gpt-transcribe",
      embedding: vars.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
    },
    allowedSignupEmails: (env.ALLOWED_SIGNUP_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  };
}
