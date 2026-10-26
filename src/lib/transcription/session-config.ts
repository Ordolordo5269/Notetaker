// Builds the OpenAI transcription configuration. Shared by the client-secret
// route (live sessions) and the per-turn HTTP transcription route.
//
// Documented constraints (developers.openai.com/api/docs/guides/realtime-transcription):
//  * gpt-live-transcribe uses `languages` (never together with `language`).
//  * turn_detection must be null/omitted for gpt-live-transcribe.
//  * keywords: one line each, no "<", ">", CR or LF; the API rejects them otherwise.
//  * delay: minimal | low | medium | high | xhigh.

export const TRANSCRIPTION_LANGUAGES = ["es", "en"] as const;
export const TRANSCRIPTION_DELAYS = ["minimal", "low", "medium", "high", "xhigh"] as const;
export type TranscriptionDelay = (typeof TRANSCRIPTION_DELAYS)[number];

const MAX_KEYWORDS = 60;
const MAX_KEYWORD_LENGTH = 80;
const MAX_PROMPT_LENGTH = 900;

export function sanitizeKeywords(input: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const kw = raw
      .replace(/[<>\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_KEYWORD_LENGTH);
    const key = kw.toLowerCase();
    if (!kw || seen.has(key)) continue;
    seen.add(key);
    out.push(kw);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

export function buildTranscriptionPrompt(ctx: { subjectName?: string | null; lectureTitle?: string | null }): string {
  const parts = ["University lecture"];
  if (ctx.subjectName) parts.push(`subject: ${ctx.subjectName}`);
  if (ctx.lectureTitle) parts.push(`topic: ${ctx.lectureTitle}`);
  const prompt =
    `${parts.join("; ")}. The lecturer speaks Spanish and/or English and may switch language between ` +
    `sentences or within a sentence. Write exactly what is said, in the language in which it is said. ` +
    `Keep legal citations, article numbers, names and technical terms as spoken.`;
  return prompt.replace(/[<>]/g, "").slice(0, MAX_PROMPT_LENGTH);
}

export interface TranscriptionContext {
  subjectName?: string | null;
  lectureTitle?: string | null;
  keywords: readonly string[];
}

/** `audio.input.transcription` block for a Realtime transcription session. */
export function buildLiveTranscription(model: string, ctx: TranscriptionContext, delay: TranscriptionDelay) {
  const keywords = sanitizeKeywords(ctx.keywords);
  return {
    model,
    prompt: buildTranscriptionPrompt(ctx),
    languages: [...TRANSCRIPTION_LANGUAGES],
    ...(keywords.length ? { keywords } : {}),
    delay,
  };
}

/** Full transcription session config (client secret + session.update). */
export function buildTranscriptionSession(model: string, ctx: TranscriptionContext, delay: TranscriptionDelay) {
  return {
    type: "transcription" as const,
    audio: {
      input: {
        format: { type: "audio/pcm" as const, rate: 24000 as const },
        // Laptop on a desk, lecturer a few metres away.
        noise_reduction: { type: "far_field" as const },
        transcription: buildLiveTranscription(model, ctx, delay),
        turn_detection: null,
      },
    },
  };
}
