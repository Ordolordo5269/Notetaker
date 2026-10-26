// Browser client for OpenAI Realtime transcription sessions over WebSocket,
// authenticated with a short-lived client secret minted by our server.
//
// Protocol used (verified against the official docs, 2026-10-26):
//   → session.update            { session: { type: "transcription", audio: { input: {...} } } }
//   → input_audio_buffer.append { audio: base64 PCM16 }
//   → input_audio_buffer.commit
//   ← session.created / session.updated
//   ← input_audio_buffer.committed            { item_id, previous_item_id }
//   ← conversation.item.input_audio_transcription.delta     { item_id, delta }
//   ← conversation.item.input_audio_transcription.completed { item_id, transcript, usage }
//   ← conversation.item.input_audio_transcription.failed    { item_id, error }
//   ← error
//
// The client owns no transcript state: it maps provider item ids to our turn
// sequence numbers and reports events; the session controller reconciles.
import { pcm16ToBase64 } from "@/lib/audio/wav";

export interface ClientSecretResponse {
  clientSecret: string;
  expiresAt: number;
  model: string;
  url: string;
  session: Record<string, unknown>;
}

export type RealtimeStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed" | "failed";

export interface RealtimeEvents {
  onStatus: (status: RealtimeStatus, detail?: string) => void;
  /** Provisional text for a turn (concatenated deltas). */
  onPartial: (turnSeq: number, text: string) => void;
  onCompleted: (turnSeq: number, transcript: string, itemId: string, audioSeconds: number | null) => void;
  onFailed: (turnSeq: number, message: string) => void;
  /** Turns committed while connected but never answered (socket died): need HTTP fallback. */
  onOrphaned: (turnSeqs: number[]) => void;
}

interface ServerEvent {
  type: string;
  event_id?: string;
  item_id?: string;
  previous_item_id?: string | null;
  delta?: string;
  transcript?: string;
  usage?: { type?: string; seconds?: number };
  error?: { message?: string; code?: string; type?: string; event_id?: string };
  session?: Record<string, unknown>;
}

const MAX_RECONNECT_ATTEMPTS = 6;
const COMMIT_TIMEOUT_MS = 45_000;

export class RealtimeTranscriptionClient {
  private ws: WebSocket | null = null;
  private status: RealtimeStatus = "idle";
  private secret: ClientSecretResponse | null = null;
  private reconnectAttempts = 0;
  private closedByUser = false;
  private sessionConfigured = false;
  /** Turns committed in order; the next `input_audio_buffer.committed` event belongs to the first. */
  private awaitingItem: { seq: number; at: number }[] = [];
  private itemToSeq = new Map<string, number>();
  private seqToItem = new Map<number, string>();
  /** Deltas that arrived before the committed event (keyed by item id). */
  private unassigned = new Map<string, string>();
  private partialBySeq = new Map<number, string>();
  /** Open (uncommitted) turn receiving deltas right now. */
  private currentSeq: number | null = null;
  private pendingCompletion = new Map<number, ReturnType<typeof setTimeout>>();
  private bytesSinceCommit = 0;

  constructor(
    private readonly fetchSecret: () => Promise<ClientSecretResponse>,
    private readonly events: RealtimeEvents,
  ) {}

  get currentStatus() {
    return this.status;
  }

  get isOpen() {
    return this.status === "open" && this.ws?.readyState === WebSocket.OPEN;
  }

  async connect(): Promise<void> {
    this.closedByUser = false;
    await this.open();
  }

  close() {
    this.closedByUser = true;
    this.setStatus("closed");
    this.teardownSocket();
    const orphans = this.drainOutstanding();
    if (orphans.length) this.events.onOrphaned(orphans);
  }

  /** Begin a new turn: deltas from now on belong to `seq` until committed. */
  beginTurn(seq: number) {
    this.currentSeq = seq;
    this.bytesSinceCommit = 0;
  }

  /** Returns false when the audio could not be sent (caller must keep it for fallback). */
  appendAudio(pcm: Int16Array): boolean {
    if (!this.isOpen) return false;
    try {
      this.ws!.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcm16ToBase64(pcm) }));
      this.bytesSinceCommit += pcm.byteLength;
      return true;
    } catch {
      return false;
    }
  }

  /** Commit the current turn. Returns false if nothing could be committed. */
  commitTurn(seq: number): boolean {
    if (!this.isOpen || this.bytesSinceCommit === 0) {
      this.currentSeq = null;
      this.bytesSinceCommit = 0;
      return false;
    }
    try {
      this.ws!.send(JSON.stringify({ type: "input_audio_buffer.commit", event_id: `commit_${seq}` }));
    } catch {
      return false;
    }
    this.awaitingItem.push({ seq, at: Date.now() });
    this.currentSeq = null;
    this.bytesSinceCommit = 0;
    const timer = setTimeout(() => {
      // No final transcript within the timeout: hand the turn to the HTTP fallback.
      if (this.pendingCompletion.delete(seq)) {
        this.awaitingItem = this.awaitingItem.filter((a) => a.seq !== seq);
        const item = this.seqToItem.get(seq);
        if (item) {
          this.itemToSeq.delete(item);
          this.seqToItem.delete(seq);
        }
        this.partialBySeq.delete(seq);
        this.events.onOrphaned([seq]);
      }
    }, COMMIT_TIMEOUT_MS);
    this.pendingCompletion.set(seq, timer);
    return true;
  }

  /** Discard buffered audio that was never committed (e.g. silence between turns). */
  clearBuffer() {
    if (!this.isOpen) return;
    try {
      this.ws!.send(JSON.stringify({ type: "input_audio_buffer.clear" }));
    } catch {
      /* ignore */
    }
    this.bytesSinceCommit = 0;
  }

  // ---------------------------------------------------------------------------

  private setStatus(status: RealtimeStatus, detail?: string) {
    if (this.status === status && !detail) return;
    this.status = status;
    this.events.onStatus(status, detail);
  }

  private async open(): Promise<void> {
    if (this.closedByUser) return;
    this.setStatus(this.reconnectAttempts > 0 ? "reconnecting" : "connecting");
    try {
      if (!this.secret || this.secret.expiresAt - Date.now() < 60_000) {
        this.secret = await this.fetchSecret();
      }
    } catch (err) {
      this.scheduleReconnect(`No se pudo obtener la credencial temporal: ${(err as Error).message}`);
      return;
    }
    const { url, clientSecret } = this.secret;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url, ["realtime", `openai-insecure-api-key.${clientSecret}`]);
    } catch (err) {
      this.scheduleReconnect(`WebSocket no disponible: ${(err as Error).message}`);
      return;
    }
    this.ws = ws;
    this.sessionConfigured = false;
    ws.onopen = () => {
      // Session config travels with the client secret; re-sending it is
      // harmless and covers servers that start from defaults.
      ws.send(JSON.stringify({ type: "session.update", session: this.secret!.session }));
    };
    ws.onmessage = (e) => this.handleMessage(e.data as string);
    ws.onerror = () => {
      /* onclose follows with the code */
    };
    ws.onclose = (e) => {
      console.debug(
        `[studyflow] realtime socket closed code=${e.code} reason=${e.reason} configured=${this.sessionConfigured}`,
      );
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closedByUser) return;
      const orphans = this.drainOutstanding();
      if (orphans.length) this.events.onOrphaned(orphans);
      if (e.code === 1008 || e.code === 4001 || e.code === 4003) this.secret = null; // auth problems: new secret
      this.scheduleReconnect(`Conexión cerrada (${e.code}${e.reason ? `: ${e.reason}` : ""})`);
    };
  }

  private handleMessage(raw: string) {
    let ev: ServerEvent;
    try {
      ev = JSON.parse(raw) as ServerEvent;
    } catch {
      return;
    }
    switch (ev.type) {
      case "session.created":
      case "session.updated":
      case "transcription_session.created":
      case "transcription_session.updated": {
        if (!this.sessionConfigured) {
          this.sessionConfigured = true;
          this.reconnectAttempts = 0;
          this.setStatus("open");
        }
        return;
      }
      case "input_audio_buffer.committed": {
        const next = this.awaitingItem.shift();
        if (!next || !ev.item_id) return;
        this.itemToSeq.set(ev.item_id, next.seq);
        this.seqToItem.set(next.seq, ev.item_id);
        const early = this.unassigned.get(ev.item_id);
        if (early) {
          this.unassigned.delete(ev.item_id);
          const existing = this.partialBySeq.get(next.seq) ?? "";
          const merged = existing.endsWith(early) ? existing : existing + early;
          this.partialBySeq.set(next.seq, merged);
          this.events.onPartial(next.seq, merged);
        }
        return;
      }
      case "conversation.item.input_audio_transcription.delta": {
        if (!ev.item_id || !ev.delta) return;
        let seq = this.itemToSeq.get(ev.item_id);
        if (seq === undefined) {
          if (this.currentSeq !== null && this.awaitingItem.length === 0) {
            // Deltas for the audio currently in the buffer: pre-assign the item id
            // (only when no earlier commit is still waiting for its item id).
            seq = this.currentSeq;
            this.itemToSeq.set(ev.item_id, seq);
            this.seqToItem.set(seq, ev.item_id);
          } else {
            this.unassigned.set(ev.item_id, (this.unassigned.get(ev.item_id) ?? "") + ev.delta);
            return;
          }
        }
        const text = (this.partialBySeq.get(seq) ?? "") + ev.delta;
        this.partialBySeq.set(seq, text);
        this.events.onPartial(seq, text);
        return;
      }
      case "conversation.item.input_audio_transcription.completed": {
        if (!ev.item_id) return;
        const seq = this.itemToSeq.get(ev.item_id);
        if (seq === undefined) return;
        this.settle(seq, ev.item_id);
        const seconds = ev.usage?.type === "duration" && typeof ev.usage.seconds === "number" ? ev.usage.seconds : null;
        this.events.onCompleted(seq, (ev.transcript ?? "").trim(), ev.item_id, seconds);
        return;
      }
      case "conversation.item.input_audio_transcription.failed": {
        if (!ev.item_id) return;
        const seq = this.itemToSeq.get(ev.item_id);
        if (seq === undefined) return;
        this.settle(seq, ev.item_id);
        this.events.onFailed(seq, ev.error?.message ?? "La transcripción de este fragmento falló.");
        return;
      }
      case "error": {
        const msg = ev.error?.message ?? "Error del servicio de transcripción";
        const code = ev.error?.code ?? "";
        console.debug("[studyflow] realtime error event", code, msg);
        // An empty commit is not fatal: nothing was lost.
        if (code === "input_audio_buffer_commit_empty") {
          const seq = this.awaitingItem.shift()?.seq;
          if (seq !== undefined) {
            const t = this.pendingCompletion.get(seq);
            if (t) clearTimeout(t);
            this.pendingCompletion.delete(seq);
            this.events.onCompleted(seq, "", "", 0);
          }
          return;
        }
        if (!this.sessionConfigured) {
          // Session could not be configured: do not loop forever on a bad config.
          this.setStatus("failed", msg);
          this.closedByUser = true;
          this.teardownSocket();
          return;
        }
        this.events.onStatus(this.status, msg);
        return;
      }
      default:
        return;
    }
  }

  private settle(seq: number, itemId: string) {
    const t = this.pendingCompletion.get(seq);
    if (t) clearTimeout(t);
    this.pendingCompletion.delete(seq);
    this.itemToSeq.delete(itemId);
    this.seqToItem.delete(seq);
    this.partialBySeq.delete(seq);
    this.awaitingItem = this.awaitingItem.filter((a) => a.seq !== seq);
  }

  private drainOutstanding(): number[] {
    const seqs = new Set<number>();
    for (const a of this.awaitingItem) seqs.add(a.seq);
    for (const seq of this.pendingCompletion.keys()) seqs.add(seq);
    if (this.currentSeq !== null && this.bytesSinceCommit > 0) seqs.add(this.currentSeq);
    for (const t of this.pendingCompletion.values()) clearTimeout(t);
    this.pendingCompletion.clear();
    this.awaitingItem = [];
    this.itemToSeq.clear();
    this.seqToItem.clear();
    this.unassigned.clear();
    this.partialBySeq.clear();
    this.currentSeq = null;
    this.bytesSinceCommit = 0;
    return [...seqs].sort((a, b) => a - b);
  }

  private teardownSocket() {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      try {
        ws.close(1000, "client closed");
      } catch {
        /* ignore */
      }
    }
  }

  private scheduleReconnect(reason: string) {
    if (this.closedByUser) return;
    this.reconnectAttempts++;
    if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      this.setStatus("failed", reason);
      return;
    }
    this.setStatus("reconnecting", reason);
    const delay = Math.min(15_000, 500 * 2 ** (this.reconnectAttempts - 1)) + Math.random() * 300;
    setTimeout(() => void this.open(), delay);
  }

  /** Reset the attempt counter (e.g. network came back) and reconnect now. */
  retryNow() {
    if (this.closedByUser) return;
    this.reconnectAttempts = 0;
    if (!this.ws) void this.open();
  }
}
