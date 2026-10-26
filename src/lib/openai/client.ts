// Thin, dependency-free adapter over the OpenAI REST API (fetch only, so it
// runs unchanged in Workers, Workflows and Node). Only endpoints and fields
// verified against the official docs on 2026-10-26 are used:
//   POST /v1/responses                (structured outputs via text.format json_schema)
//   POST /v1/embeddings
//   POST /v1/audio/transcriptions     (gpt-transcribe: prompt, keywords[], languages[])
//   POST /v1/realtime/client_secrets  (ephemeral key for a transcription session)
import type { AppConfig } from "@/lib/env";
import { AppError } from "@/lib/errors";

export class OpenAIError extends AppError {
  constructor(
    status: number,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(status >= 500 || status === 429 ? 502 : status, "openai_error", message);
    this.name = "OpenAIError";
  }
}

export interface OpenAIUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

function authHeaders(config: AppConfig): Record<string, string> {
  if (config.openaiProxyAuth) return {};
  if (!config.openaiApiKey) {
    throw new AppError(503, "openai_not_configured", "Falta configurar OPENAI_API_KEY en el servidor.");
  }
  return { Authorization: `Bearer ${config.openaiApiKey}` };
}

export function openaiConfigured(config: AppConfig): boolean {
  return config.openaiProxyAuth || Boolean(config.openaiApiKey);
}

async function openaiFetch(
  config: AppConfig,
  path: string,
  init: { method?: string; json?: unknown; form?: FormData; signal?: AbortSignal; safetyId?: string },
  attempt = 0,
): Promise<Response> {
  const headers: Record<string, string> = { ...authHeaders(config) };
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  if (init.safetyId) headers["OpenAI-Safety-Identifier"] = init.safetyId;
  let res: Response;
  try {
    res = await fetch(`${config.openaiBaseUrl}${path}`, {
      method: init.method ?? "POST",
      headers,
      body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
      signal: init.signal,
    });
  } catch (err) {
    if (attempt < 2 && !init.signal?.aborted) {
      await sleep(800 * 2 ** attempt);
      return openaiFetch(config, path, init, attempt + 1);
    }
    throw new OpenAIError(502, `No se pudo contactar con OpenAI: ${(err as Error).message}`, true);
  }
  if (res.ok) return res;
  const retryable = res.status === 429 || res.status >= 500;
  if (retryable && attempt < 2) {
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 20) * 1000 : 1500 * 2 ** attempt);
    return openaiFetch(config, path, init, attempt + 1);
  }
  let message = `OpenAI respondió ${res.status}`;
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body.error?.message) message = `OpenAI: ${body.error.message}`;
  } catch {
    /* ignore */
  }
  throw new OpenAIError(res.status, message, retryable);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Responses API
// ---------------------------------------------------------------------------

export interface JsonSchema {
  name: string;
  schema: Record<string, unknown>;
}

export interface StructuredRequest {
  model: string;
  system: string;
  user: string;
  schema: JsonSchema;
  reasoningEffort?: "none" | "low" | "medium" | "high";
  maxOutputTokens?: number;
  safetyId?: string;
  signal?: AbortSignal;
}

interface ResponsesBody {
  status?: string;
  output?: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[];
  output_text?: string;
  incomplete_details?: { reason?: string } | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  };
}

function extractText(body: ResponsesBody): { text: string; refusal: string | null } {
  if (typeof body.output_text === "string" && body.output_text) return { text: body.output_text, refusal: null };
  let text = "";
  let refusal: string | null = null;
  for (const item of body.output ?? []) {
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type === "output_text" && c.text) text += c.text;
      if (c.type === "refusal" && c.refusal) refusal = c.refusal;
    }
  }
  return { text, refusal };
}

function usageOf(body: ResponsesBody): OpenAIUsage {
  return {
    inputTokens: body.usage?.input_tokens ?? 0,
    cachedInputTokens: body.usage?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
  };
}

/** Call the Responses API with a strict JSON schema and parse the result. */
export async function createStructured<T>(
  config: AppConfig,
  req: StructuredRequest,
): Promise<{ data: T; usage: OpenAIUsage }> {
  const res = await openaiFetch(config, "/responses", {
    signal: req.signal,
    safetyId: req.safetyId,
    json: {
      model: req.model,
      input: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      ...(req.reasoningEffort && req.reasoningEffort !== "none" ? { reasoning: { effort: req.reasoningEffort } } : {}),
      ...(req.maxOutputTokens ? { max_output_tokens: req.maxOutputTokens } : {}),
      text: { format: { type: "json_schema", name: req.schema.name, strict: true, schema: req.schema.schema } },
      store: false,
    },
  });
  const body = (await res.json()) as ResponsesBody;
  const usage = usageOf(body);
  if (body.status === "incomplete") {
    throw new OpenAIError(
      502,
      `Respuesta incompleta del modelo (${body.incomplete_details?.reason ?? "motivo desconocido"}).`,
      true,
    );
  }
  const { text, refusal } = extractText(body);
  if (refusal) throw new OpenAIError(422, `El modelo rechazó la petición: ${refusal}`, false);
  try {
    return { data: JSON.parse(text) as T, usage };
  } catch {
    throw new OpenAIError(502, "La respuesta del modelo no es JSON válido.", true);
  }
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

export const EMBEDDING_DIMENSIONS = 512;

export async function createEmbeddings(
  config: AppConfig,
  inputs: string[],
  opts: { signal?: AbortSignal } = {},
): Promise<{ vectors: Float32Array[]; usage: OpenAIUsage }> {
  if (!inputs.length) return { vectors: [], usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 } };
  const res = await openaiFetch(config, "/embeddings", {
    signal: opts.signal,
    json: { model: config.models.embedding, input: inputs, dimensions: EMBEDDING_DIMENSIONS },
  });
  const body = (await res.json()) as {
    data: { index: number; embedding: number[] }[];
    usage?: { prompt_tokens?: number };
  };
  const vectors: Float32Array[] = new Array(inputs.length);
  for (const d of body.data) vectors[d.index] = Float32Array.from(d.embedding);
  return {
    vectors,
    usage: { inputTokens: body.usage?.prompt_tokens ?? 0, cachedInputTokens: 0, outputTokens: 0 },
  };
}

// ---------------------------------------------------------------------------
// File transcription (gpt-transcribe)
// ---------------------------------------------------------------------------

export interface FileTranscription {
  text: string;
  languages: { code: string }[];
  audioSeconds: number;
}

export async function transcribeFile(
  config: AppConfig,
  file: Blob,
  fileName: string,
  ctx: {
    prompt?: string;
    keywords?: readonly string[];
    languages?: readonly string[];
    signal?: AbortSignal;
    safetyId?: string;
  },
): Promise<FileTranscription> {
  const form = new FormData();
  form.set("file", file, fileName);
  form.set("model", config.models.file);
  if (ctx.prompt) form.set("prompt", ctx.prompt);
  for (const k of ctx.keywords ?? []) form.append("keywords[]", k);
  for (const l of ctx.languages ?? []) form.append("languages[]", l);
  const res = await openaiFetch(config, "/audio/transcriptions", {
    form,
    signal: ctx.signal,
    safetyId: ctx.safetyId,
  });
  const body = (await res.json()) as {
    text?: string;
    languages?: { code: string }[];
    usage?: { type?: string; seconds?: number };
  };
  return {
    text: (body.text ?? "").trim(),
    languages: Array.isArray(body.languages) ? body.languages : [],
    audioSeconds: body.usage?.type === "duration" ? (body.usage.seconds ?? 0) : 0,
  };
}

// ---------------------------------------------------------------------------
// Realtime client secrets
// ---------------------------------------------------------------------------

export interface ClientSecret {
  value: string;
  expiresAt: number;
}

export async function createRealtimeClientSecret(
  config: AppConfig,
  session: Record<string, unknown>,
  opts: { ttlSeconds?: number; safetyId?: string } = {},
): Promise<ClientSecret> {
  const res = await openaiFetch(config, "/realtime/client_secrets", {
    safetyId: opts.safetyId,
    json: {
      expires_after: { anchor: "created_at", seconds: Math.min(7200, Math.max(10, opts.ttlSeconds ?? 600)) },
      session,
    },
  });
  const body = (await res.json()) as { value?: string; expires_at?: number };
  if (!body.value) throw new OpenAIError(502, "OpenAI no devolvió un token temporal.", true);
  return { value: body.value, expiresAt: (body.expires_at ?? Math.floor(Date.now() / 1000) + 600) * 1000 };
}

/** Stable, privacy-preserving per-user identifier for OpenAI abuse monitoring. */
export async function safetyIdentifier(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`studyflow:${userId}`));
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
