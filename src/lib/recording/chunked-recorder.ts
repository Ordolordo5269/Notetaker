// Persistent audio recording as a sequence of standalone files.
//
// MediaRecorder blobs produced with `timeslice` are not independently
// playable (only the first carries the container header), so the recorder is
// rotated: a new MediaRecorder starts ROTATION_OVERLAP_MS before the previous
// one stops. Every chunk is therefore a complete, playable file and no audio
// is lost at the boundary. Within a chunk, timeslice parts are persisted to
// IndexedDB every PART_INTERVAL_MS so a crash loses at most a few seconds.
import { localStore, type LocalPart } from "./local-store";
import { sha256Blob } from "./hash";

export const ROTATION_OVERLAP_MS = 300;
const PART_INTERVAL_MS = 5000;

export interface FinishedChunk {
  id: string;
  seq: number;
  blob: Blob;
  mime: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  overlapMs: number;
  partial: boolean;
  sha256: string;
}

interface ActiveRecorder {
  recorder: MediaRecorder;
  chunkId: string;
  seq: number;
  startMs: number;
  overlapMs: number;
  parts: Blob[];
  partIndex: number;
  stopped: Promise<FinishedChunk | null>;
  resolveStopped: (c: FinishedChunk | null) => void;
  endMs: number | null;
}

export interface ChunkedRecorderOptions {
  sessionId: string;
  stream: MediaStream;
  mime: string;
  /** Returns the current position on the active timeline (ms). */
  clock: () => number;
  /** Allocates the next chunk sequence number (persisted by the caller). */
  nextSeq: () => number;
  /** Rotation interval; shorter on browsers whose partial files are not recoverable. */
  chunkMs: number;
  onChunk: (chunk: FinishedChunk) => void;
  onError: (message: string) => void;
}

export class ChunkedRecorder {
  private active: ActiveRecorder | null = null;
  private rotateTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private readonly o: ChunkedRecorderOptions;

  constructor(options: ChunkedRecorderOptions) {
    this.o = options;
  }

  get isRunning() {
    return this.running;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.beginRecorder(0);
    this.scheduleRotation();
  }

  /** Stop recording; resolves once the last chunk has been produced. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    if (this.rotateTimer) clearTimeout(this.rotateTimer);
    this.rotateTimer = null;
    const current = this.active;
    this.active = null;
    if (current) await this.stopRecorder(current);
  }

  private scheduleRotation() {
    if (this.rotateTimer) clearTimeout(this.rotateTimer);
    this.rotateTimer = setTimeout(() => void this.rotate(), this.o.chunkMs);
  }

  private async rotate() {
    if (!this.running) return;
    const previous = this.active;
    // Start the next file first, then stop the previous one after the overlap.
    this.beginRecorder(ROTATION_OVERLAP_MS);
    this.scheduleRotation();
    if (previous) {
      await new Promise((r) => setTimeout(r, ROTATION_OVERLAP_MS));
      await this.stopRecorder(previous);
    }
  }

  private beginRecorder(overlapMs: number) {
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(this.o.stream, { mimeType: this.o.mime, audioBitsPerSecond: 48_000 });
    } catch (err) {
      this.o.onError(`No se pudo iniciar la grabación (${(err as Error).message}).`);
      return;
    }
    let resolveStopped: (c: FinishedChunk | null) => void = () => undefined;
    const stopped = new Promise<FinishedChunk | null>((r) => (resolveStopped = r));
    const entry: ActiveRecorder = {
      recorder,
      chunkId: crypto.randomUUID(),
      seq: this.o.nextSeq(),
      startMs: Math.max(0, this.o.clock() - overlapMs),
      overlapMs,
      parts: [],
      partIndex: 0,
      stopped,
      resolveStopped,
      endMs: null,
    };
    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) {
        entry.parts.push(e.data);
        const part: LocalPart = {
          key: `${this.o.sessionId}:${entry.seq}:${entry.partIndex}`,
          sessionId: this.o.sessionId,
          seq: entry.seq,
          index: entry.partIndex,
          chunkId: entry.chunkId,
          blob: e.data,
          mime: this.o.mime,
          startMs: entry.startMs,
          overlapMs: entry.overlapMs,
          atMs: this.o.clock(),
        };
        entry.partIndex++;
        void localStore.putPart(part).catch(() => this.o.onError("No se pudo guardar audio en este dispositivo."));
      }
    };
    recorder.onerror = () => {
      this.o.onError("El grabador de audio falló. Se intentará continuar con un nuevo fragmento.");
    };
    recorder.onstop = () => {
      void this.finishChunk(entry).then(entry.resolveStopped);
    };
    try {
      recorder.start(PART_INTERVAL_MS);
    } catch (err) {
      this.o.onError(`No se pudo iniciar la grabación (${(err as Error).message}).`);
      return;
    }
    this.active = entry;
  }

  private async stopRecorder(entry: ActiveRecorder) {
    entry.endMs = this.o.clock();
    if (entry.recorder.state !== "inactive") {
      try {
        entry.recorder.requestData();
      } catch {
        /* ignore */
      }
      entry.recorder.stop();
    } else {
      entry.resolveStopped(await this.finishChunk(entry));
    }
    await entry.stopped;
  }

  private async finishChunk(entry: ActiveRecorder): Promise<FinishedChunk | null> {
    if (!entry.parts.length) {
      await localStore.deleteParts(this.o.sessionId, entry.seq).catch(() => undefined);
      return null;
    }
    const blob = new Blob(entry.parts, { type: this.o.mime });
    const endMs = entry.endMs ?? this.o.clock();
    const chunk: FinishedChunk = {
      id: entry.chunkId,
      seq: entry.seq,
      blob,
      mime: this.o.mime,
      startMs: entry.startMs,
      endMs,
      durationMs: Math.max(0, endMs - entry.startMs),
      overlapMs: entry.overlapMs,
      partial: false,
      sha256: await sha256Blob(blob),
    };
    this.o.onChunk(chunk);
    return chunk;
  }
}

/**
 * Rebuild chunks from timeslice parts left behind by an interrupted recorder
 * (tab closed or crashed). The result may be truncated and is flagged partial.
 */
export async function recoverPartsAsChunks(sessionId: string): Promise<FinishedChunk[]> {
  const parts = await localStore.listParts(sessionId);
  const bySeq = new Map<number, LocalPart[]>();
  for (const p of parts) {
    const list = bySeq.get(p.seq) ?? [];
    list.push(p);
    bySeq.set(p.seq, list);
  }
  const out: FinishedChunk[] = [];
  for (const [seq, list] of [...bySeq.entries()].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => a.index - b.index);
    const first = list[0]!;
    const blob = new Blob(
      list.map((p) => p.blob),
      { type: first.mime },
    );
    const endMs = Math.max(first.startMs, list[list.length - 1]!.atMs);
    out.push({
      id: first.chunkId,
      seq,
      blob,
      mime: first.mime,
      startMs: first.startMs,
      endMs,
      durationMs: endMs - first.startMs,
      overlapMs: first.overlapMs,
      partial: true,
      sha256: await sha256Blob(blob),
    });
  }
  return out;
}
