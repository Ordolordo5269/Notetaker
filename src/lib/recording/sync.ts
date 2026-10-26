// Upload queue: pushes local chunks, transcript segments, markers and pending
// audio turns to the server. Idempotent by design (chunk seq + sha256,
// segment seq, marker id) so retries never duplicate anything. A row is
// marked synced only after the server answered 2xx.
import { api, ApiError, parseApiError } from "@/lib/api/client";
import { localStore, type LocalChunk, type PendingTurn } from "./local-store";

export interface SyncSnapshot {
  pendingChunks: number;
  pendingSegments: number;
  pendingMarkers: number;
  pendingTurns: number;
  uploading: boolean;
  lastError: string | null;
  lastSyncAt: number | null;
}

export interface TurnTranscribed {
  seq: number;
  text: string;
  language: string;
  languageSource: "heuristic" | "model";
}

type Listener = (s: SyncSnapshot) => void;

export class SyncQueue {
  private snapshot: SyncSnapshot = {
    pendingChunks: 0,
    pendingSegments: 0,
    pendingMarkers: 0,
    pendingTurns: 0,
    uploading: false,
    lastError: null,
    lastSyncAt: null,
  };
  private listeners = new Set<Listener>();
  private running = false;
  private scheduled: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private backoff = 1000;
  /** Live audio seconds confirmed since the last segment batch (for usage accounting). */
  private liveSecondsAccumulated = 0;

  constructor(
    private readonly sessionId: string,
    private readonly onTurnTranscribed: (t: TurnTranscribed) => void,
  ) {}

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn(this.snapshot);
    return () => this.listeners.delete(fn);
  }

  get state() {
    return this.snapshot;
  }

  addLiveSeconds(seconds: number) {
    this.liveSecondsAccumulated += seconds;
  }

  /** Ask the queue to run soon (coalesces bursts). */
  kick(delayMs = 150) {
    if (this.stopped) return;
    if (this.scheduled) return;
    this.scheduled = setTimeout(() => {
      this.scheduled = null;
      void this.run();
    }, delayMs);
  }

  stop() {
    this.stopped = true;
    if (this.scheduled) clearTimeout(this.scheduled);
    this.scheduled = null;
  }

  /** Undo stop(); used when a screen is re-mounted (React StrictMode). */
  resume() {
    this.stopped = false;
  }

  /** Run until nothing is pending or an error stops progress. */
  async flush(): Promise<SyncSnapshot> {
    await this.run();
    return this.snapshot;
  }

  async refreshCounts() {
    const [chunks, segments, markers, turns] = await Promise.all([
      localStore.listChunks(this.sessionId),
      localStore.listSegments(this.sessionId),
      localStore.listMarkers(this.sessionId),
      localStore.listPendingTurns(this.sessionId),
    ]);
    this.update({
      pendingChunks: chunks.filter((c) => !c.synced).length,
      pendingSegments: segments.filter((s) => !s.synced).length,
      pendingMarkers: markers.filter((m) => !m.synced).length,
      pendingTurns: turns.length,
    });
  }

  private update(patch: Partial<SyncSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l(this.snapshot);
  }

  private async run() {
    if (this.running || this.stopped) return;
    this.running = true;
    this.update({ uploading: true });
    let hadError = false;
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        this.update({ lastError: "Sin conexión" });
        hadError = true;
      } else {
        await this.syncSegments();
        await this.syncMarkers();
        await this.syncTurns();
        await this.syncChunks();
        this.update({ lastError: null, lastSyncAt: Date.now() });
        this.backoff = 1000;
      }
    } catch (err) {
      hadError = true;
      if (err instanceof ApiError && err.status === 401) {
        this.update({ lastError: "Sesión caducada. Vuelve a iniciar sesión; los datos siguen en este dispositivo." });
      } else {
        this.update({ lastError: err instanceof Error ? err.message : "Error de sincronización" });
      }
    } finally {
      await this.refreshCounts().catch(() => undefined);
      this.update({ uploading: false });
      this.running = false;
    }
    const s = this.snapshot;
    const pending = s.pendingChunks + s.pendingSegments + s.pendingMarkers + s.pendingTurns;
    if (pending > 0 && !this.stopped) {
      const delay = hadError ? this.backoff : 200;
      if (hadError) this.backoff = Math.min(30_000, this.backoff * 2);
      this.kick(delay);
    }
  }

  private async syncSegments() {
    const rows = (await localStore.listSegments(this.sessionId)).filter((s) => !s.synced);
    if (!rows.length && this.liveSecondsAccumulated === 0) return;
    const sentAt = Date.now();
    const seconds = this.liveSecondsAccumulated;
    this.liveSecondsAccumulated = 0;
    for (let i = 0; i < Math.max(1, rows.length); i += 200) {
      const batch = rows.slice(i, i + 200);
      try {
        await api(`/api/sessions/${this.sessionId}/segments`, {
          body: {
            segments: batch.map((s) => ({
              seq: s.seq,
              text: s.text,
              status: s.status,
              source: s.source,
              startMs: s.startMs,
              endMs: s.endMs,
              providerItemId: s.providerItemId,
              language: s.language,
              languageSource: s.languageSource,
            })),
            ...(i === 0 && seconds > 0 ? { liveAudioSeconds: seconds } : {}),
          },
        });
      } catch (err) {
        this.liveSecondsAccumulated += i === 0 ? seconds : 0;
        throw err;
      }
      await localStore.markSegmentsSynced(
        this.sessionId,
        batch.map((s) => s.seq),
        sentAt,
      );
    }
  }

  private async syncMarkers() {
    const rows = (await localStore.listMarkers(this.sessionId)).filter((m) => !m.synced);
    for (const m of rows) {
      if (m.deleted) {
        try {
          await api(`/api/sessions/${this.sessionId}/markers/${m.id}`, { method: "DELETE" });
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 404)) throw err;
        }
      } else {
        await api(`/api/sessions/${this.sessionId}/markers`, {
          body: { id: m.id, type: m.type, atMs: m.atMs, note: m.note },
        });
      }
      await localStore.markMarkerSynced(m.id);
    }
  }

  private async syncTurns() {
    const turns = await localStore.listPendingTurns(this.sessionId);
    for (const t of turns) {
      if (t.attempts >= 8) continue; // keep it; the user can retry later
      try {
        const result = await transcribeTurnViaHttp(this.sessionId, t);
        await localStore.deletePendingTurn(t.key);
        this.onTurnTranscribed(result);
      } catch (err) {
        await localStore.bumpPendingTurn(t.key);
        if (err instanceof ApiError && (err.status === 400 || err.status === 402 || err.status === 413)) {
          // Not retryable: drop the turn but keep a visible failure.
          await localStore.deletePendingTurn(t.key);
          this.onTurnTranscribed({ seq: t.seq, text: "", language: "und", languageSource: "heuristic" });
          this.update({ lastError: err.message });
          continue;
        }
        throw err;
      }
    }
  }

  private async syncChunks() {
    const chunks = (await localStore.listChunks(this.sessionId)).filter((c) => !c.synced);
    for (const c of chunks) {
      try {
        await uploadChunk(this.sessionId, c);
        await localStore.markChunkSynced(c.key);
        this.update({ pendingChunks: Math.max(0, this.snapshot.pendingChunks - 1) });
      } catch (err) {
        await localStore.bumpChunkAttempt(c.key);
        throw err;
      }
    }
  }
}

export async function uploadChunk(sessionId: string, c: LocalChunk): Promise<void> {
  const res = await fetch(`/api/sessions/${sessionId}/chunks/${c.seq}`, {
    method: "PUT",
    credentials: "same-origin",
    headers: {
      "Content-Type": c.mime,
      "x-chunk-id": c.id,
      "x-sha256": c.sha256,
      "x-start-ms": String(Math.round(c.startMs)),
      "x-end-ms": String(Math.round(c.endMs)),
      "x-duration-ms": String(Math.round(c.durationMs)),
      "x-overlap-ms": String(Math.round(c.overlapMs)),
      "x-partial": c.partial ? "1" : "0",
    },
    body: c.blob,
  });
  if (!res.ok) throw await parseApiError(res);
}

export async function transcribeTurnViaHttp(sessionId: string, t: PendingTurn): Promise<TurnTranscribed> {
  const form = new FormData();
  form.set("audio", t.wav, `turn-${t.seq}.wav`);
  form.set("seq", String(t.seq));
  form.set("startMs", String(Math.round(t.startMs)));
  form.set("endMs", String(Math.round(t.endMs)));
  form.set("source", t.source);
  const res = await fetch(`/api/sessions/${sessionId}/transcribe-turn`, {
    method: "POST",
    credentials: "same-origin",
    body: form,
  });
  if (!res.ok) throw await parseApiError(res);
  return (await res.json()) as TurnTranscribed;
}
