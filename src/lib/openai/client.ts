// Thin, dependency-free adapter over the OpenAI REST API (fetch only, so it
// runs unchanged in Workers, Workflows and Node). Only endpoints and fields
// verified against the official docs on 2026-10-26 are used:
//   POST /v1/responses                (structured outputs via text.format json_schema)
//   POST /v1/embeddings
//   POST /v1/audio/transcriptions     (gpt-transcribe: prompt, keywords[], languages[])
//   POST /v1/realtime/client_secrets  (ephemeral key for a transcription session)
import type { AppConfig } from "@/lib/env";
import { AppError } from "@/lib/errors";

/**
 * Upstream OpenAI failures are reported to the browser as 502 (not the user's
 * fault, never their session): an invalid server key must not look like a
 * 401 of our own authentication. Only a refusal keeps its 422.
 */
export class OpenAIError extends AppError {
  public readonly upstreamStatus: number;
  constructor(
    status: number,
    message: string,
    public readonly retryable: boolean,
  ) {
    const auth = status === 401 || status === 403;
    super(
      status === 422 ? 422 : 502,
      auth ? "openai_auth" : "openai_error",
      auth
        ? "La clave de OpenAI configurada en el servidor no es válida o no tiene permisos. Revisa el secreto OPENAI_API_KEY."
        : message,
    );
    this.upstreamStatus = status;
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
  const startedAt = Date.now();
  const debug = config.appEnv !== "production";
  if (debug) console.debug(`[openai] → ${init.method ?? "POST"} ${path}`);
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
  if (debug) console.debug(`[openai] ← ${res.status} ${path} in ${Date.now() - startedAt} ms`);
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

/**
 * Server-sent events of a streamed Responses call. Streaming is used for
 * every generation: long drafts keep bytes flowing (intermediaries with idle
 * timeouts stay happy) and the final event carries status and usage.
 */
async function readResponsesStream(res: Response): Promise<ResponsesBody> {
  if (!res.body) throw new OpenAIError(502, "Respuesta vacía de OpenAI.", true);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let final: ResponsesBody | null = null;
  const handle = (eventName: string, data: string) => {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = (payload.type as string | undefined) ?? eventName;
    if (type === "response.output_text.delta") {
      text += (payload.delta as string | undefined) ?? "";
    } else if (type === "response.completed" || type === "response.incomplete" || type === "response.failed") {
      final = payload.response as ResponsesBody;
    } else if (type === "error") {
      const err = payload.error as { message?: string } | undefined;
      throw new OpenAIError(502, `OpenAI: ${err?.message ?? (payload.message as string) ?? "error en el flujo"}`, true);
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let eventName = "";
      const dataLines: string[] = [];
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      if (dataLines.length) handle(eventName, dataLines.join("\n"));
    }
  }
  if (!final) {
    throw new OpenAIError(502, "El flujo de OpenAI terminó sin un evento final.", true);
  }
  const body = final as ResponsesBody;
  if (!body.output_text && text) body.output_text = text;
  return body;
}

const MAX_OUTPUT_TOKENS_CAP = 32_000;

function lowerEffort(effort: StructuredRequest["reasoningEffort"]): StructuredRequest["reasoningEffort"] {
  return effort === "high" ? "medium" : effort === "medium" ? "low" : effort;
}

function addUsage(a: OpenAIUsage, b: OpenAIUsage): OpenAIUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}

/**
 * Call the Responses API with a strict JSON schema and parse the result.
 * `max_output_tokens` also covers reasoning tokens, so a long lecture can
 * exhaust it; an incomplete answer is retried with a larger budget and less
 * reasoning before giving up (usage of every attempt is returned).
 */
export async function createStructured<T>(
  config: AppConfig,
  req: StructuredRequest,
): Promise<{ data: T; usage: OpenAIUsage }> {
  let maxOutputTokens = req.maxOutputTokens;
  let effort = req.reasoningEffort;
  let usage: OpenAIUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  for (let attempt = 0; ; attempt++) {
    const res = await openaiFetch(config, "/responses", {
      signal: req.signal,
      safetyId: req.safetyId,
      json: {
        model: req.model,
        input: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        ...(effort && effort !== "none" ? { reasoning: { effort } } : {}),
        ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}),
        text: { format: { type: "json_schema", name: req.schema.name, strict: true, schema: req.schema.schema } },
        store: false,
        stream: true,
      },
    });
    const body = await readResponsesStream(res);
    usage = addUsage(usage, usageOf(body));
    if (body.status === "incomplete") {
      const reason = body.incomplete_details?.reason ?? "motivo desconocido";
      const canExpand = reason === "max_output_tokens" && attempt < 2 && (maxOutputTokens ?? 0) < MAX_OUTPUT_TOKENS_CAP;
      if (canExpand) {
        maxOutputTokens = Math.min(MAX_OUTPUT_TOKENS_CAP, (maxOutputTokens ?? 8000) * 2);
        effort = lowerEffort(effort);
        if (config.appEnv !== "production") {
          console.warn(
            `[openai] incomplete (${reason}); retrying with max_output_tokens=${maxOutputTokens}, effort=${effort}`,
          );
        }
        continue;
      }
      throw new OpenAIError(502, `Respuesta incompleta del modelo (${reason}).`, true);
    }
    if (body.status === "failed") throw new OpenAIError(502, "El modelo no pudo completar la respuesta.", true);
    const { text, refusal } = extractText(body);
    if (refusal) throw new OpenAIError(422, `El modelo rechazó la petición: ${refusal}`, false);
    try {
      return { data: JSON.parse(text) as T, usage };
    } catch {
      throw new OpenAIError(502, "La respuesta del modelo no es JSON válido.", true);
    }
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
