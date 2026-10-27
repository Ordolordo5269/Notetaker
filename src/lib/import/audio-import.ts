// Imports an audio file (iPhone voice memo, mp3, wav…) as a lecture.
//
// Everything heavy happens in the browser with ffmpeg.wasm: the file is cut
// into 20–40 s chunks at natural pauses WITHOUT re-encoding (the original bits
// are kept), each chunk is uploaded through the same endpoint a live recording
// uses, the lecture is finalized and a server job transcribes the chunks with
// the file model and, optionally, launches the notes. The tab must stay open
// until the upload finishes; the transcription then continues on the server.
//
// The ffmpeg.wasm JavaScript (the small @ffmpeg/ffmpeg ESM build) is vendored in
// /public/ffmpeg and loaded at runtime, outside the bundler: its web worker is
// resolved relative to its own URL. The 32 MB core comes from the CDN once.
import { api, ApiError } from "@/lib/api/client";
import { parseSilences, pickOutput, planSegments } from "./plan";
export { titleFromFileName } from "./plan";

/** ffmpeg.wasm core, loaded once from the CDN (≈ 32 MB, cached by the browser afterwards). */
export const FFMPEG_CORE_VERSION = "0.12.10";
const CORE_BASE = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm`;
const FFMPEG_MODULE_PATH = "/ffmpeg/index.js";
export const MAX_IMPORT_SECONDS = 4 * 3600;
export const MAX_IMPORT_BYTES = 1024 * 1024 * 1024;

/** The subset of @ffmpeg/ffmpeg's FFmpeg class this module uses. */
interface FFmpeg {
  load(config: { coreURL: string; wasmURL: string }): Promise<boolean>;
  exec(args: string[], timeout?: number): Promise<number>;
  ffprobe(args: string[], timeout?: number): Promise<number>;
  writeFile(path: string, data: Uint8Array | string): Promise<boolean>;
  readFile(path: string, encoding?: string): Promise<Uint8Array | string>;
  deleteFile(path: string): Promise<boolean>;
  listDir(path: string): Promise<{ name: string; isDir: boolean }[]>;
  on(event: "log", cb: (e: { type: string; message: string }) => void): void;
  on(event: "progress", cb: (e: { progress: number; time: number }) => void): void;
  off(event: "log", cb: (e: { type: string; message: string }) => void): void;
  off(event: "progress", cb: (e: { progress: number; time: number }) => void): void;
  terminate(): void;
}

export type ImportPhase = "loading" | "reading" | "analyzing" | "cutting" | "uploading" | "finalizing" | "done";
export interface ImportProgress {
  phase: ImportPhase;
  /** 0–1 when known. */
  ratio: number | null;
  detail: string | null;
}

export interface ImportResult {
  lectureId: string;
  chunks: number;
  durationMs: number;
  /** Transcription job id, or null when the job could not start (no OpenAI key, budget…). */
  jobId: string | null;
  warning: string | null;
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

let loader: Promise<FFmpeg> | null = null;

/** Dynamic import the bundler leaves alone: the module lives in /public, not in the build. */
const importAtRuntime = new Function("url", "return import(url)") as (
  url: string,
) => Promise<{ FFmpeg: new () => FFmpeg }>;

/** Downloads a resource into a same-origin blob URL (the worker cannot import cross-origin scripts). */
async function toBlobURL(url: string, mimeType: string, onProgress?: (ratio: number) => void): Promise<string> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new ImportError(`No se pudo descargar el conversor de audio (${res.status}).`);
  const total = Number(res.headers.get("content-length") ?? "0");
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    received += value.byteLength;
    onProgress?.(total > 0 ? Math.min(1, received / total) : 0);
  }
  return URL.createObjectURL(new Blob(parts as BlobPart[], { type: mimeType }));
}

export function loadFfmpeg(onDownload?: (ratio: number) => void): Promise<FFmpeg> {
  if (!loader) {
    loader = (async () => {
      const { FFmpeg: FFmpegClass } = await importAtRuntime(`${window.location.origin}${FFMPEG_MODULE_PATH}`);
      const ffmpeg = new FFmpegClass();
      const coreURL = await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript");
      const wasmURL = await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm", onDownload);
      await ffmpeg.load({ coreURL, wasmURL });
      return ffmpeg;
    })().catch((err) => {
      loader = null;
      throw err;
    });
  }
  return loader;
}

/** Frees the hundreds of MB the converter holds; the next import loads it again (from cache). */
export function unloadFfmpeg(): void {
  const pending = loader;
  loader = null;
  void pending?.then((f) => f.terminate()).catch(() => undefined);
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeExtension(name: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name.trim());
  return m ? m[1]!.toLowerCase() : "bin";
}

async function readText(ffmpeg: FFmpeg, name: string): Promise<string> {
  const data = await ffmpeg.readFile(name);
  return typeof data === "string" ? data : new TextDecoder().decode(data);
}

async function probe(ffmpeg: FFmpeg, name: string): Promise<{ duration: number; codec: string | null }> {
  await ffmpeg.ffprobe([
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_name,codec_type",
    "-of",
    "json",
    name,
    "-o",
    "probe.json",
  ]);
  const json = JSON.parse(await readText(ffmpeg, "probe.json")) as {
    format?: { duration?: string };
    streams?: { codec_name?: string; codec_type?: string }[];
  };
  await ffmpeg.deleteFile("probe.json").catch(() => undefined);
  const audio = json.streams?.find((s) => s.codec_type === "audio");
  return { duration: Number(json.format?.duration ?? 0), codec: audio?.codec_name ?? null };
}

async function segmentDuration(ffmpeg: FFmpeg, name: string): Promise<number> {
  await ffmpeg.ffprobe(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", name, "-o", "dur.txt"]);
  const text = await readText(ffmpeg, "dur.txt");
  await ffmpeg.deleteFile("dur.txt").catch(() => undefined);
  const d = Number(text.trim());
  return Number.isFinite(d) ? d : 0;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new ImportError("Importación cancelada.");
}

export async function importAudioFile(input: {
  file: File;
  title: string;
  subjectId: string | null;
  thenNotes: boolean;
  signal?: AbortSignal;
  onProgress: (p: ImportProgress) => void;
}): Promise<ImportResult> {
  const { file, signal, onProgress } = input;
  if (file.size === 0) throw new ImportError("El archivo está vacío.");
  if (file.size > MAX_IMPORT_BYTES) throw new ImportError("El archivo supera 1 GB.");

  onProgress({ phase: "loading", ratio: null, detail: null });
  const ffmpeg = await loadFfmpeg((ratio) => onProgress({ phase: "loading", ratio, detail: null }));
  throwIfAborted(signal);

  const inName = `input.${safeExtension(file.name)}`;
  const cleanup = async (names: string[]) => {
    for (const n of names) await ffmpeg.deleteFile(n).catch(() => undefined);
  };

  onProgress({ phase: "reading", ratio: null, detail: null });
  await ffmpeg.writeFile(inName, new Uint8Array(await file.arrayBuffer()));
  let lectureId: string | null = null;
  let segmentNames: string[] = [];
  try {
    const info = await probe(ffmpeg, inName);
    if (!info.codec || !(info.duration > 0)) throw new ImportError("El archivo no contiene audio que se pueda leer.");
    if (info.duration > MAX_IMPORT_SECONDS) {
      throw new ImportError("El archivo dura más de 4 horas; divídelo antes de importarlo.");
    }
    const out = pickOutput(info.codec);
    throwIfAborted(signal);

    // Pauses, so chunks end between sentences rather than mid-word.
    onProgress({ phase: "analyzing", ratio: 0, detail: null });
    const logLines: string[] = [];
    const onLog = ({ message }: { message: string }) => {
      if (message.includes("silence_")) logLines.push(message);
    };
    const onAnalyzeProgress = ({ progress }: { progress: number }) =>
      onProgress({ phase: "analyzing", ratio: Math.min(1, Math.max(0, progress)), detail: null });
    ffmpeg.on("log", onLog);
    ffmpeg.on("progress", onAnalyzeProgress);
    try {
      await ffmpeg.exec([
        "-hide_banner",
        "-nostats",
        "-i",
        inName,
        "-vn",
        "-af",
        "silencedetect=noise=-30dB:d=0.35",
        "-f",
        "null",
        "-",
      ]);
    } finally {
      ffmpeg.off("log", onLog);
      ffmpeg.off("progress", onAnalyzeProgress);
    }
    throwIfAborted(signal);
    const plan = planSegments(info.duration, parseSilences(logLines.join("\n")));

    const cutDetail = out.copy ? null : "Convirtiendo a AAC";
    onProgress({ phase: "cutting", ratio: 0, detail: cutDetail });
    const onCutProgress = ({ progress }: { progress: number }) =>
      onProgress({ phase: "cutting", ratio: Math.min(1, Math.max(0, progress)), detail: cutDetail });
    ffmpeg.on("progress", onCutProgress);
    try {
      const codecArgs = out.copy ? ["-c", "copy"] : ["-c:a", "aac", "-b:a", "64k", "-ac", "1"];
      const common = ["-hide_banner", "-nostats", "-i", inName, "-vn", "-map", "0:a:0", ...codecArgs];
      if (plan.length === 1) {
        await ffmpeg.exec([...common, `seg00000.${out.ext}`]);
      } else {
        await ffmpeg.exec([
          ...common,
          "-f",
          "segment",
          "-segment_times",
          plan
            .slice(0, -1)
            .map((s) => s.end.toFixed(3))
            .join(","),
          "-reset_timestamps",
          "1",
          `seg%05d.${out.ext}`,
        ]);
      }
    } finally {
      ffmpeg.off("progress", onCutProgress);
    }
    await cleanup([inName]);
    throwIfAborted(signal);

    const pattern = new RegExp(`^seg\\d{5}\\.${out.ext}$`);
    segmentNames = (await ffmpeg.listDir("/"))
      .filter((e) => !e.isDir && pattern.test(e.name))
      .map((e) => e.name)
      .sort();
    if (!segmentNames.length) throw new ImportError("No se pudo trocear el audio.");

    // Exact spans: the cuts land on frame boundaries, so measure each piece.
    const spans: { startMs: number; endMs: number }[] = [];
    let cursorMs = 0;
    for (const name of segmentNames) {
      const d = await segmentDuration(ffmpeg, name);
      const startMs = Math.round(cursorMs);
      cursorMs += d * 1000;
      spans.push({ startMs, endMs: Math.max(startMs + 1, Math.round(cursorMs)) });
    }
    const durationMs = spans[spans.length - 1]!.endMs;

    // The lecture exists only once there is something to upload.
    const created = await api<{ lecture: { id: string } }>("/api/sessions", {
      body: {
        title: input.title,
        subjectId: input.subjectId,
        origin: "import",
        sourceFileName: file.name.slice(0, 255),
      },
    });
    lectureId = created.lecture.id;
    await api(`/api/sessions/${lectureId}/status`, {
      body: { action: "start", transcriptionMode: "turns", audioMime: out.mime },
    });

    onProgress({ phase: "uploading", ratio: 0, detail: `0/${segmentNames.length}` });
    let uploaded = 0;
    const queue = segmentNames.map((name, i) => ({ name, i }));
    const total = segmentNames.length;
    const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
      while (queue.length) {
        throwIfAborted(signal);
        const { name, i } = queue.shift()!;
        const data = await ffmpeg.readFile(name);
        if (typeof data === "string") throw new ImportError("Lectura inesperada del fragmento.");
        const sha = await sha256Hex(data);
        const span = spans[i]!;
        await uploadWithRetry(lectureId!, i, {
          body: new Blob([data as BlobPart], { type: out.mime }),
          mime: out.mime,
          sha256: sha,
          startMs: span.startMs,
          endMs: span.endMs,
        });
        await ffmpeg.deleteFile(name).catch(() => undefined);
        uploaded++;
        onProgress({ phase: "uploading", ratio: uploaded / total, detail: `${uploaded}/${total}` });
      }
    });
    await Promise.all(workers);
    segmentNames = [];

    onProgress({ phase: "finalizing", ratio: null, detail: null });
    await api(`/api/sessions/${lectureId}/status`, {
      body: {
        action: "finalize",
        durationMs,
        expectedChunks: spans.length,
        expectedSequences: spans.map((_, i) => i),
      },
    });

    let jobId: string | null = null;
    let warning: string | null = null;
    try {
      const launched = await api<{ job: { id: string } }>(`/api/sessions/${lectureId}/jobs`, {
        body: { type: "recovery_transcription", thenNotes: input.thenNotes, language: "auto" },
      });
      jobId = launched.job.id;
    } catch (err) {
      // The audio is safe; only the transcription could not start (no key, budget…).
      warning = err instanceof Error ? err.message : String(err);
    }
    onProgress({ phase: "done", ratio: 1, detail: null });
    return { lectureId, chunks: spans.length, durationMs, jobId, warning };
  } catch (err) {
    await cleanup([inName, ...segmentNames]);
    if (lectureId) {
      const reason = err instanceof Error ? err.message.slice(0, 500) : "Importación interrumpida";
      await api(`/api/sessions/${lectureId}/status`, { body: { action: "fail", reason } }).catch(() => undefined);
    }
    throw err;
  }
}

async function uploadWithRetry(
  lectureId: string,
  seq: number,
  c: { body: Blob; mime: string; sha256: string; startMs: number; endMs: number },
): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`/api/sessions/${lectureId}/chunks/${seq}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: {
          "Content-Type": c.mime,
          "x-chunk-id": crypto.randomUUID(),
          "x-sha256": c.sha256,
          "x-start-ms": String(c.startMs),
          "x-end-ms": String(c.endMs),
          "x-duration-ms": String(c.endMs - c.startMs),
          "x-overlap-ms": "0",
          "x-partial": "0",
        },
        body: c.body,
      });
      if (res.ok) return;
      const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      const code = body?.error?.code ?? `http_${res.status}`;
      const message = body?.error?.message ?? `Error ${res.status} al subir el audio`;
      // Client errors other than a damaged transfer will not get better by retrying.
      if (res.status < 500 && code !== "integrity_mismatch") throw new ApiError(res.status, code, message);
      lastError = new ApiError(res.status, code, message);
    } catch (err) {
      if (err instanceof ApiError && err.status < 500 && err.code !== "integrity_mismatch") throw err;
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  throw lastError instanceof Error ? lastError : new ImportError("No se pudo subir el audio.");
}
