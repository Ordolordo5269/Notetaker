// Orchestrates one recording session in the browser:
//   microphone → PCM frames → VAD turns → Realtime transcription (or HTTP fallback)
//   microphone → MediaRecorder chunks → IndexedDB → upload queue → R2
//
// Invariants
//   * The persistent recording never depends on the transcription path.
//   * Nothing is reported as saved/transcribed before it is confirmed.
//   * Every turn's audio is kept until a final transcript exists, so a lost
//     WebSocket only delays transcription (HTTP fallback), never loses text.
import { MicCapture, pickRecorderMime, CaptureError, PCM_SAMPLE_RATE, type PcmFrame } from "@/lib/audio/capture";
import { VoiceActivityDetector, PRE_ROLL_FRAMES } from "@/lib/audio/vad";
import { pcm16ToWav } from "@/lib/audio/wav";
import { api, ApiError, errorMessage } from "@/lib/api/client";
import type { MarkerType, SegmentLanguage, SessionStatus } from "@/lib/db/schema";
import { detectSegmentLanguage } from "@/lib/transcription/language";
import {
  RealtimeTranscriptionClient,
  type ClientSecretResponse,
  type RealtimeStatus,
} from "@/lib/transcription/realtime-client";
import { ChunkedRecorder, recoverPartsAsChunks, type FinishedChunk } from "./chunked-recorder";
import {
  checkStorage,
  localStore,
  type LocalMarker,
  type LocalSegment,
  type LocalSessionState,
  type StorageHealth,
} from "./local-store";
import { createStore } from "./store";
import { SyncQueue, type SyncSnapshot, type TurnTranscribed } from "./sync";

export type Phase =
  | "loading"
  | "idle"
  | "recovery"
  | "starting"
  | "recording"
  | "paused"
  | "finalizing"
  | "finished"
  | "error";

export type TranscriptionStatus = "off" | "connecting" | "live" | "reconnecting" | "fallback" | "failed" | "paused";

export interface TurnView {
  seq: number;
  startMs: number;
  endMs: number | null;
  text: string;
  state: "listening" | "provisional" | "processing" | "final" | "failed" | "gap";
  language: SegmentLanguage;
  languageSource: "heuristic" | "model";
}

export interface LectureHeader {
  id: string;
  title: string;
  subjectName: string | null;
  subjectColor: string | null;
  status: SessionStatus;
}

export interface RecoveryInfo {
  localChunks: number;
  unsyncedChunks: number;
  recoveredPartialChunks: number;
  pendingTurns: number;
  lastTimelineMs: number;
  serverStatus: SessionStatus;
  localFinalized: boolean;
}

export interface Notice {
  id: number;
  tone: "neutral" | "warning" | "danger" | "accent";
  text: string;
  at: number;
}

export interface SessionState {
  phase: Phase;
  lecture: LectureHeader | null;
  micLabel: string;
  micDeviceId: string | null;
  micLost: boolean;
  micPermissionDenied: boolean;
  transcription: { mode: "realtime" | "turns"; status: TranscriptionStatus; detail: string | null };
  turns: TurnView[];
  markers: LocalMarker[];
  sync: SyncSnapshot;
  online: boolean;
  storage: StorageHealth | null;
  recovery: RecoveryInfo | null;
  error: string | null;
  notices: Notice[];
  missingChunks: number[] | null;
  wakeLock: boolean;
}

export interface ClockState {
  timelineMs: number;
  level: number;
  speaking: boolean;
}

const HEARTBEAT_MS = 30_000;
const FRAME_MS = 100;

function isSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg/.test(ua);
}

export class SessionController {
  readonly store = createStore<SessionState>({
    phase: "loading",
    lecture: null,
    micLabel: "",
    micDeviceId: null,
    micLost: false,
    micPermissionDenied: false,
    transcription: { mode: "realtime", status: "off", detail: null },
    turns: [],
    markers: [],
    sync: {
      pendingChunks: 0,
      pendingSegments: 0,
      pendingMarkers: 0,
      pendingTurns: 0,
      uploading: false,
      lastError: null,
      lastSyncAt: null,
    },
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    storage: null,
    recovery: null,
    error: null,
    notices: [],
    missingChunks: null,
    wakeLock: false,
  });
  readonly clock = createStore<ClockState>({ timelineMs: 0, level: 0, speaking: false });

  private capture: MicCapture | null = null;
  private recorder: ChunkedRecorder | null = null;
  private realtime: RealtimeTranscriptionClient | null = null;
  private sync: SyncQueue;
  private vad = new VoiceActivityDetector();
  private local: LocalSessionState | null = null;
  private mime = "";

  // Timeline clock (active recording time, pauses excluded).
  private baseMs = 0;
  private runningSincePerf: number | null = null;
  private framesSinceResume = 0;
  private resumeBaseMs = 0;

  // Turn assembly.
  private preRoll: Int16Array[] = [];
  private openTurn: { seq: number; startMs: number; frames: Int16Array[]; needsFallback: boolean } | null = null;
  private turnAudio = new Map<number, { frames: Int16Array[]; startMs: number; endMs: number }>();
  private turnViews = new Map<number, TurnView>();
  private liveSecondsBySeq = new Map<number, number>();

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private wakeLockSentinel: WakeLockSentinel | null = null;
  private levelSmoothed = 0;
  private noticeId = 0;
  private disposed = false;
  private cleanupFns: (() => void)[] = [];
  private initPromise: Promise<void> | null = null;

  constructor(readonly sessionId: string) {
    this.sync = new SyncQueue(sessionId, (t) => this.onHttpTurnResult(t));
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Idempotent: React StrictMode mounts, unmounts and mounts again. The
   * second call re-attaches subscriptions and window events after dispose().
   */
  init(): Promise<void> {
    this.disposed = false;
    this.sync.resume();
    this.cleanupFns.push(this.sync.subscribe((s) => this.store.set({ sync: s })));
    this.bindWindowEvents();
    if (!this.initPromise) this.initPromise = this.load();
    return this.initPromise;
  }

  private async load(): Promise<void> {
    try {
      const { lecture } = await api<{
        lecture: {
          id: string;
          title: string;
          subjectName: string | null;
          subjectColor: string | null;
          status: SessionStatus;
        };
      }>(`/api/sessions/${this.sessionId}`);
      this.store.set({
        lecture: {
          id: lecture.id,
          title: lecture.title,
          subjectName: lecture.subjectName,
          subjectColor: lecture.subjectColor,
          status: lecture.status,
        },
      });
      const local = await localStore.getSession(this.sessionId);
      this.local = local ?? null;
      await this.loadLocalTranscript();
      await this.sync.refreshCounts();
      void checkStorage().then((storage) => this.store.set({ storage }));

      if (lecture.status === "ready") {
        this.store.set({ phase: "finished" });
        return;
      }
      const sync = this.sync.state;
      const hasLocalWork =
        local &&
        (sync.pendingChunks + sync.pendingTurns + sync.pendingSegments + sync.pendingMarkers > 0 ||
          local.timelineMs > 0);
      const serverOpen = lecture.status !== "created";
      if (hasLocalWork || serverOpen) {
        await this.prepareRecovery(lecture.status);
        return;
      }
      this.store.set({ phase: "idle" });
    } catch (err) {
      this.store.set({ phase: "error", error: errorMessage(err) });
    }
  }

  dispose() {
    this.disposed = true;
    for (const fn of this.cleanupFns) fn();
    this.cleanupFns = [];
    this.stopTimers();
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    this.sync.stop();
    this.realtime?.close();
    void this.recorder?.stop();
    void this.capture?.close();
    void this.releaseWakeLock();
  }

  async start(deviceId?: string | null): Promise<void> {
    const s = this.store.get();
    if (s.phase !== "idle" && s.phase !== "recovery") return;
    this.store.set({ phase: "starting", error: null, missingChunks: null });
    try {
      const storage = await checkStorage();
      this.store.set({ storage });
      if (storage.low)
        this.notice("warning", "Queda poco espacio en este dispositivo. El audio podría no guardarse localmente.");

      await this.openMicrophone(deviceId ?? this.store.get().micDeviceId);
      const mime = pickRecorderMime();
      if (!mime)
        throw new CaptureError("unsupported", "Este navegador no puede grabar audio (MediaRecorder no disponible).");
      this.mime = mime;

      const resumingLocal = this.local !== null;
      if (!this.local) {
        this.local = {
          sessionId: this.sessionId,
          timelineMs: 0,
          nextChunkSeq: 0,
          nextTurnSeq: 0,
          mime,
          transcriptionMode: "realtime",
          updatedAt: Date.now(),
          finalized: false,
        };
        await localStore.putSession(this.local);
      } else {
        this.local.mime = mime;
        this.local.finalized = false;
      }
      this.baseMs = this.local.timelineMs;

      const lectureStatus = this.store.get().lecture?.status ?? "created";
      const action =
        lectureStatus === "created"
          ? "start"
          : lectureStatus === "paused"
            ? "resume"
            : lectureStatus === "recording"
              ? null
              : "recover";
      if (action === "recover") {
        await api(`/api/sessions/${this.sessionId}/status`, { body: { action: "recover" } });
        await api(`/api/sessions/${this.sessionId}/status`, { body: { action: "resume", durationMs: this.baseMs } });
      } else if (action) {
        await api(`/api/sessions/${this.sessionId}/status`, {
          body:
            action === "start"
              ? { action, transcriptionMode: "realtime", audioMime: mime }
              : { action, durationMs: this.baseMs },
        });
      }
      this.store.set((p) => ({ lecture: p.lecture ? { ...p.lecture, status: "recording" } : p.lecture }));

      if (resumingLocal && this.baseMs > 0) {
        this.addGapTurn(this.baseMs, "Intervalo no grabado: la sesión se interrumpió y se reanudó más tarde.");
      }

      this.startClock();
      this.startRecorder();
      this.startTranscription();
      this.startTimers();
      void this.requestWakeLock();
      this.store.set({ phase: "recording", recovery: null });
      this.sync.kick();
    } catch (err) {
      await this.capture?.close();
      this.capture = null;
      const denied = err instanceof CaptureError && err.code === "denied";
      this.store.set({
        phase: this.local && this.local.timelineMs > 0 ? "recovery" : "idle",
        error: errorMessage(err),
        micPermissionDenied: denied,
      });
    }
  }

  async pause(): Promise<void> {
    if (this.store.get().phase !== "recording") return;
    this.closeOpenTurn("hard_max");
    await this.recorder?.stop();
    this.recorder = null;
    this.stopClock();
    this.store.set({ phase: "paused", transcription: { ...this.store.get().transcription, status: "paused" } });
    await this.checkpoint();
    await api(`/api/sessions/${this.sessionId}/status`, {
      body: { action: "pause", durationMs: this.timelineMs() },
    }).catch((e) => this.notice("warning", `No se pudo registrar la pausa en el servidor: ${errorMessage(e)}`));
  }

  async resume(): Promise<void> {
    if (this.store.get().phase !== "paused") return;
    if (!this.capture?.live) {
      await this.openMicrophone(this.store.get().micDeviceId);
    }
    await this.capture?.resume();
    this.startClock();
    this.startRecorder();
    this.store.set({ phase: "recording", micLost: false });
    this.refreshTranscriptionStatus();
    await api(`/api/sessions/${this.sessionId}/status`, {
      body: { action: "resume", durationMs: this.timelineMs() },
    }).catch((e) => this.notice("warning", `No se pudo registrar la reanudación en el servidor: ${errorMessage(e)}`));
  }

  /** Stop recording and close the lecture once every chunk is on the server. */
  async finalize(opts: { acceptMissing?: boolean } = {}): Promise<void> {
    const phase = this.store.get().phase;
    if (phase === "recording" || phase === "paused" || phase === "recovery") {
      this.store.set({ phase: "finalizing", error: null });
      this.closeOpenTurn("hard_max");
      await this.recorder?.stop();
      this.recorder = null;
      this.stopClock();
      this.realtime?.close();
      this.realtime = null;
      await this.capture?.close();
      this.capture = null;
      this.stopTimers();
      void this.releaseWakeLock();
      if (this.local) {
        this.local.finalized = true;
        await this.checkpoint();
      }
    } else if (phase !== "finalizing") {
      return;
    }
    await this.completeFinalize(opts);
  }

  private async completeFinalize(opts: { acceptMissing?: boolean }) {
    const snapshot = await this.sync.flush();
    const pending = snapshot.pendingChunks + snapshot.pendingTurns + snapshot.pendingSegments + snapshot.pendingMarkers;
    if (pending > 0 && !opts.acceptMissing) {
      this.store.set({
        error:
          snapshot.lastError ??
          "Quedan datos pendientes de sincronizar. Mantén esta pestaña abierta; se reintentará automáticamente.",
      });
      return;
    }
    try {
      const expectedChunks = this.local?.nextChunkSeq ?? 0;
      const res = await api<{ missingChunks: number[] }>(`/api/sessions/${this.sessionId}/status`, {
        body: {
          action: "finalize",
          durationMs: this.timelineMs(),
          expectedChunks,
          acceptMissing: Boolean(opts.acceptMissing),
        },
      });
      this.store.set({ phase: "finished", missingChunks: res.missingChunks, error: null });
      if (!res.missingChunks.length) await localStore.purgeSession(this.sessionId).catch(() => undefined);
    } catch (err) {
      if (err instanceof ApiError && err.code === "chunks_missing") {
        await this.sync.refreshCounts();
        this.store.set({ error: err.message });
        this.sync.kick(1000);
        return;
      }
      this.store.set({ error: errorMessage(err) });
    }
  }

  /** Retry the pending uploads and the finalize call. */
  async retryFinalize(acceptMissing = false) {
    if (this.store.get().phase !== "finalizing") return;
    this.store.set({ error: null });
    await this.completeFinalize({ acceptMissing });
  }

  // ---------------------------------------------------------------------------
  // Markers
  // ---------------------------------------------------------------------------

  async addMarker(type: MarkerType, note?: string | null): Promise<void> {
    const marker: LocalMarker = {
      id: crypto.randomUUID(),
      sessionId: this.sessionId,
      type,
      atMs: this.timelineMs(),
      note: note?.trim() || null,
      synced: false,
      createdAt: Date.now(),
    };
    await localStore.putMarker(marker);
    this.store.set((p) => ({ markers: [...p.markers, marker].sort((a, b) => a.atMs - b.atMs) }));
    this.sync.kick();
  }

  async removeMarker(id: string) {
    const m = this.store.get().markers.find((x) => x.id === id);
    if (!m) return;
    await localStore.putMarker({ ...m, deleted: true, synced: false });
    this.store.set((p) => ({ markers: p.markers.filter((x) => x.id !== id) }));
    this.sync.kick();
  }

  // ---------------------------------------------------------------------------
  // Microphone
  // ---------------------------------------------------------------------------

  async switchMicrophone(deviceId: string | null) {
    const phase = this.store.get().phase;
    if (phase !== "recording" && phase !== "paused") {
      this.store.set({ micDeviceId: deviceId });
      return;
    }
    const wasRecording = phase === "recording";
    if (wasRecording) {
      this.closeOpenTurn("hard_max");
      await this.recorder?.stop();
      this.recorder = null;
      this.stopClock();
    }
    await this.capture?.close();
    this.capture = null;
    try {
      await this.openMicrophone(deviceId);
      if (wasRecording) {
        this.startClock();
        this.startRecorder();
      }
      this.store.set({ micLost: false });
      this.notice("neutral", `Micrófono cambiado a ${this.store.get().micLabel || "otro dispositivo"}.`);
    } catch (err) {
      this.store.set({ micLost: true, error: errorMessage(err) });
    }
  }

  /** After the system took the microphone away, try to get it back and continue. */
  async reconnectMicrophone() {
    await this.switchMicrophone(this.store.get().micDeviceId);
  }

  private async openMicrophone(deviceId?: string | null) {
    const capture = await MicCapture.open({
      deviceId: deviceId ?? undefined,
      onFrame: (f) => this.onFrame(f),
      onTrackEnded: () => void this.onMicLost(),
    });
    this.capture = capture;
    this.store.set({
      micLabel: capture.deviceLabel,
      micDeviceId: capture.deviceId,
      micLost: false,
      micPermissionDenied: false,
    });
  }

  private async onMicLost() {
    if (this.store.get().phase !== "recording") return;
    this.closeOpenTurn("hard_max");
    const at = this.timelineMs();
    await this.recorder?.stop();
    this.recorder = null;
    this.stopClock();
    this.addGapTurn(at, "Micrófono desconectado: no se grabó audio hasta reconectarlo.");
    this.store.set({ micLost: true });
    this.notice("danger", "Micrófono desconectado. La grabación está detenida hasta que lo reconectes.");
    await this.checkpoint();
  }

  // ---------------------------------------------------------------------------
  // Clock
  // ---------------------------------------------------------------------------

  timelineMs(): number {
    return this.baseMs + (this.runningSincePerf !== null ? performance.now() - this.runningSincePerf : 0);
  }

  private startClock() {
    if (this.runningSincePerf !== null) return;
    this.runningSincePerf = performance.now();
    this.resumeBaseMs = this.baseMs;
    this.framesSinceResume = 0;
    if (!this.tickTimer) {
      this.tickTimer = setInterval(() => this.clock.set({ timelineMs: this.timelineMs() }), 250);
    }
  }

  private stopClock() {
    if (this.runningSincePerf === null) return;
    this.baseMs = this.timelineMs();
    this.runningSincePerf = null;
    this.clock.set({ timelineMs: this.baseMs, level: 0, speaking: false });
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Recorder
  // ---------------------------------------------------------------------------

  private startRecorder() {
    if (!this.capture || !this.local) return;
    const chunkMs = isSafari() ? 30_000 : 60_000;
    this.recorder = new ChunkedRecorder({
      sessionId: this.sessionId,
      stream: this.capture.stream,
      mime: this.mime,
      clock: () => this.timelineMs(),
      nextSeq: () => {
        const seq = this.local!.nextChunkSeq++;
        void this.checkpoint();
        return seq;
      },
      chunkMs,
      onChunk: (c) => void this.onChunk(c),
      onError: (m) => this.notice("danger", m),
    });
    this.recorder.start();
  }

  private async onChunk(c: FinishedChunk) {
    await localStore.putChunk({
      key: `${this.sessionId}:${c.seq}`,
      id: c.id,
      sessionId: this.sessionId,
      seq: c.seq,
      blob: c.blob,
      mime: c.mime,
      startMs: c.startMs,
      endMs: c.endMs,
      durationMs: c.durationMs,
      overlapMs: c.overlapMs,
      partial: c.partial,
      sha256: c.sha256,
      synced: false,
      attempts: 0,
      createdAt: Date.now(),
    });
    await localStore.deleteParts(this.sessionId, c.seq);
    await this.checkpoint();
    await this.sync.refreshCounts();
    this.sync.kick();
  }

  private async checkpoint() {
    if (!this.local) return;
    this.local.timelineMs = this.timelineMs();
    this.local.updatedAt = Date.now();
    this.local.mime = this.mime || this.local.mime;
    await localStore.putSession(this.local).catch(() => undefined);
  }

  // ---------------------------------------------------------------------------
  // Transcription
  // ---------------------------------------------------------------------------

  private startTranscription() {
    if (!this.local) return;
    if (this.local.transcriptionMode === "turns" || typeof WebSocket === "undefined") {
      this.local.transcriptionMode = "turns";
      this.store.set({ transcription: { mode: "turns", status: "fallback", detail: null } });
      return;
    }
    if (this.realtime) return;
    this.realtime = new RealtimeTranscriptionClient(
      () => api<ClientSecretResponse>("/api/realtime/client-secret", { body: { sessionId: this.sessionId } }),
      {
        onStatus: (status, detail) => this.onRealtimeStatus(status, detail),
        onPartial: (seq, text) => this.updateTurn(seq, { text, state: "provisional" }),
        onCompleted: (seq, transcript, itemId, seconds) =>
          void this.onTurnFinal(seq, transcript, "realtime", itemId, seconds),
        onFailed: (seq) => void this.fallbackTurn(seq),
        onOrphaned: (seqs) => {
          for (const seq of seqs) void this.fallbackTurn(seq);
        },
      },
    );
    this.store.set({ transcription: { mode: "realtime", status: "connecting", detail: null } });
    void this.realtime.connect();
  }

  private onRealtimeStatus(status: RealtimeStatus, detail?: string) {
    if (detail) console.debug(`[studyflow] realtime ${status}: ${detail}`);
    if (status === "failed") {
      this.notice(
        "warning",
        `La transcripción en directo no está disponible (${detail ?? "sin detalle"}). Se continúa transcribiendo por turnos con un pequeño retraso.`,
      );
      this.realtime?.close();
      this.realtime = null;
      if (this.local) {
        this.local.transcriptionMode = "turns";
        void this.checkpoint();
        void api(`/api/sessions/${this.sessionId}/status`, {
          body: { action: "mode", transcriptionMode: "turns" },
        }).catch(() => undefined);
      }
      this.store.set({ transcription: { mode: "turns", status: "fallback", detail: detail ?? null } });
      return;
    }
    this.refreshTranscriptionStatus(detail);
  }

  private refreshTranscriptionStatus(detail?: string) {
    const phase = this.store.get().phase;
    const mode = this.local?.transcriptionMode ?? "realtime";
    let status: TranscriptionStatus;
    if (phase === "paused") status = "paused";
    else if (mode === "turns") status = "fallback";
    else {
      const rt = this.realtime?.currentStatus ?? "idle";
      status =
        rt === "open" ? "live" : rt === "connecting" ? "connecting" : rt === "reconnecting" ? "reconnecting" : "off";
    }
    if (!this.store.get().online && status !== "paused") status = "reconnecting";
    this.store.set({ transcription: { mode, status, detail: detail ?? null } });
  }

  private onFrame(f: PcmFrame) {
    if (this.store.get().phase !== "recording" || this.runningSincePerf === null) return;
    this.framesSinceResume++;
    const frameEndMs = this.resumeBaseMs + this.framesSinceResume * FRAME_MS;
    this.levelSmoothed = this.levelSmoothed * 0.6 + Math.min(1, f.rms * 6) * 0.4;
    const ev = this.vad.push(f.rms);
    this.clock.set({ level: this.levelSmoothed, speaking: this.vad.speaking });

    if (ev?.type === "speech_start") {
      const seq = this.local!.nextTurnSeq++;
      void this.checkpoint();
      const frames = [...this.preRoll, f.pcm];
      const startMs = Math.max(0, frameEndMs - frames.length * FRAME_MS);
      this.openTurn = { seq, startMs, frames, needsFallback: false };
      this.preRoll = [];
      this.setTurn({
        seq,
        startMs,
        endMs: null,
        text: "",
        state: "listening",
        language: "und",
        languageSource: "heuristic",
      });
      if (this.realtime?.isOpen) {
        this.realtime.beginTurn(seq);
        for (const p of frames) if (!this.realtime.appendAudio(p)) this.openTurn.needsFallback = true;
      } else {
        this.openTurn.needsFallback = true;
      }
      return;
    }

    if (this.openTurn) {
      this.openTurn.frames.push(f.pcm);
      if (!this.openTurn.needsFallback && !(this.realtime?.isOpen && this.realtime.appendAudio(f.pcm))) {
        this.openTurn.needsFallback = true;
      }
      if (ev?.type === "speech_end") this.closeOpenTurn(ev.reason, frameEndMs);
      return;
    }

    this.preRoll.push(f.pcm);
    if (this.preRoll.length > PRE_ROLL_FRAMES) this.preRoll.shift();
  }

  private closeOpenTurn(_reason: string, endMsOverride?: number) {
    const t = this.openTurn;
    if (!t) {
      this.vad.flush();
      return;
    }
    this.openTurn = null;
    this.vad.flush();
    const endMs = endMsOverride ?? t.startMs + t.frames.length * FRAME_MS;
    this.turnAudio.set(t.seq, { frames: t.frames, startMs: t.startMs, endMs });
    this.updateTurn(t.seq, { endMs, state: "processing" });
    const committed = !t.needsFallback && this.realtime?.isOpen ? this.realtime.commitTurn(t.seq) : false;
    if (!committed) void this.fallbackTurn(t.seq);
  }

  /** Route a turn's audio to the HTTP transcription endpoint (gpt-transcribe). */
  private async fallbackTurn(seq: number) {
    const audio = this.turnAudio.get(seq);
    if (!audio) {
      // Audio already discarded (turn was final) or never captured.
      if (this.turnViews.get(seq)?.state !== "final") this.updateTurn(seq, { state: "failed" });
      return;
    }
    const wav = pcm16ToWav(audio.frames, PCM_SAMPLE_RATE);
    try {
      await localStore.putPendingTurn({
        key: `${this.sessionId}:${seq}`,
        sessionId: this.sessionId,
        seq,
        wav,
        startMs: audio.startMs,
        endMs: audio.endMs,
        source: "turns",
        attempts: 0,
        createdAt: Date.now(),
      });
    } catch (err) {
      console.error("[studyflow] could not persist pending turn", err);
      this.notice("danger", `No se pudo guardar un fragmento pendiente de transcribir: ${errorMessage(err)}`);
      this.updateTurn(seq, { state: "failed" });
      return;
    }
    this.turnAudio.delete(seq);
    this.updateTurn(seq, { state: "processing" });
    await this.sync.refreshCounts();
    this.sync.kick();
  }

  private onHttpTurnResult(t: TurnTranscribed) {
    void this.onTurnFinal(t.seq, t.text, "turns", null, null, t.language as SegmentLanguage, t.languageSource);
  }

  private async onTurnFinal(
    seq: number,
    transcript: string,
    source: "realtime" | "turns",
    itemId: string | null,
    seconds: number | null,
    language?: SegmentLanguage,
    languageSource?: "heuristic" | "model",
  ) {
    const audio = this.turnAudio.get(seq);
    const view = this.turnViews.get(seq);
    const startMs = view?.startMs ?? audio?.startMs ?? 0;
    const endMs = view?.endMs ?? audio?.endMs ?? startMs;
    if (source === "realtime") {
      const dur = seconds ?? (audio ? audio.frames.length * FRAME_MS * 0.001 : (endMs - startMs) / 1000);
      if (!this.liveSecondsBySeq.has(seq)) {
        this.liveSecondsBySeq.set(seq, dur);
        this.sync.addLiveSeconds(dur);
      }
      this.turnAudio.delete(seq);
    }
    const text = transcript.trim();
    if (!text) {
      this.turnViews.delete(seq);
      this.publishTurns();
      return;
    }
    const lang = language ?? detectSegmentLanguage(text);
    const segment: LocalSegment = {
      key: `${this.sessionId}:${seq}`,
      sessionId: this.sessionId,
      seq,
      text,
      status: "final",
      source,
      startMs,
      endMs,
      providerItemId: itemId,
      language: lang,
      languageSource: languageSource ?? "heuristic",
      // Turns transcribed by the server are already persisted there.
      synced: source === "turns",
      updatedAt: Date.now(),
    };
    await localStore.putSegment(segment);
    this.setTurn({ seq, startMs, endMs, text, state: "final", language: lang, languageSource: segment.languageSource });
    if (source === "realtime") this.sync.kick(400);
  }

  private addGapTurn(atMs: number, text: string) {
    if (!this.local) return;
    const seq = this.local.nextTurnSeq++;
    const seg: LocalSegment = {
      key: `${this.sessionId}:${seq}`,
      sessionId: this.sessionId,
      seq,
      text,
      status: "gap",
      source: "recovery",
      startMs: atMs,
      endMs: atMs,
      providerItemId: null,
      language: "und",
      languageSource: "heuristic",
      synced: false,
      updatedAt: Date.now(),
    };
    void localStore.putSegment(seg).then(() => this.sync.kick());
    this.setTurn({ seq, startMs: atMs, endMs: atMs, text, state: "gap", language: "und", languageSource: "heuristic" });
  }

  private setTurn(view: TurnView) {
    this.turnViews.set(view.seq, view);
    this.publishTurns();
  }

  private updateTurn(seq: number, patch: Partial<TurnView>) {
    const current = this.turnViews.get(seq);
    if (!current) return;
    if (current.state === "final" && patch.state !== "final") return;
    this.turnViews.set(seq, { ...current, ...patch });
    this.publishTurns();
  }

  private publishTurns() {
    const turns = [...this.turnViews.values()].sort((a, b) => a.startMs - b.startMs || a.seq - b.seq);
    this.store.set({ turns });
  }

  private async loadLocalTranscript() {
    const [localSegs, markers] = await Promise.all([
      localStore.listSegments(this.sessionId),
      localStore.listMarkers(this.sessionId),
    ]);
    let serverSegs: {
      seq: number;
      text: string;
      status: "final" | "failed" | "gap";
      startMs: number;
      endMs: number;
      language: SegmentLanguage;
      languageSource: "heuristic" | "model";
    }[] = [];
    try {
      serverSegs = (await api<{ segments: typeof serverSegs }>(`/api/sessions/${this.sessionId}/segments`)).segments;
    } catch {
      /* offline: local only */
    }
    for (const s of serverSegs) {
      this.turnViews.set(s.seq, {
        seq: s.seq,
        startMs: s.startMs,
        endMs: s.endMs,
        text: s.text,
        state: s.status === "gap" ? "gap" : s.status === "failed" ? "failed" : "final",
        language: s.language,
        languageSource: s.languageSource,
      });
    }
    for (const s of localSegs) {
      this.turnViews.set(s.seq, {
        seq: s.seq,
        startMs: s.startMs,
        endMs: s.endMs,
        text: s.text,
        state: s.status === "gap" ? "gap" : s.status === "failed" ? "failed" : "final",
        language: s.language,
        languageSource: s.languageSource,
      });
    }
    const pending = await localStore.listPendingTurns(this.sessionId);
    for (const t of pending) {
      if (!this.turnViews.has(t.seq)) {
        this.turnViews.set(t.seq, {
          seq: t.seq,
          startMs: t.startMs,
          endMs: t.endMs,
          text: "",
          state: "processing",
          language: "und",
          languageSource: "heuristic",
        });
      }
    }
    let serverMarkers: LocalMarker[] = [];
    try {
      const res = await api<{
        markers: { id: string; type: MarkerType; atMs: number; note: string | null; createdAt: number }[];
      }>(`/api/sessions/${this.sessionId}/markers`);
      serverMarkers = res.markers.map((m) => ({ ...m, sessionId: this.sessionId, synced: true }));
    } catch {
      /* offline */
    }
    const merged = new Map<string, LocalMarker>();
    for (const m of serverMarkers) merged.set(m.id, m);
    for (const m of markers) if (!m.deleted) merged.set(m.id, m);
    for (const m of markers) if (m.deleted) merged.delete(m.id);
    this.store.set({ markers: [...merged.values()].sort((a, b) => a.atMs - b.atMs) });
    this.publishTurns();
    if (this.local) {
      const maxSeq = Math.max(-1, ...[...this.turnViews.keys()]);
      this.local.nextTurnSeq = Math.max(this.local.nextTurnSeq, maxSeq + 1);
    }
  }

  // ---------------------------------------------------------------------------
  // Recovery
  // ---------------------------------------------------------------------------

  private async prepareRecovery(serverStatus: SessionStatus) {
    let recoveredPartial = 0;
    if (this.local) {
      const recovered = await recoverPartsAsChunks(this.sessionId);
      for (const c of recovered) {
        const existing = (await localStore.listChunks(this.sessionId)).find((x) => x.seq === c.seq);
        if (existing) {
          await localStore.deleteParts(this.sessionId, c.seq);
          continue;
        }
        await localStore.putChunk({
          key: `${this.sessionId}:${c.seq}`,
          id: c.id,
          sessionId: this.sessionId,
          seq: c.seq,
          blob: c.blob,
          mime: c.mime,
          startMs: c.startMs,
          endMs: c.endMs,
          durationMs: c.durationMs,
          overlapMs: c.overlapMs,
          partial: true,
          sha256: c.sha256,
          synced: false,
          attempts: 0,
          createdAt: Date.now(),
        });
        await localStore.deleteParts(this.sessionId, c.seq);
        recoveredPartial++;
        this.local.timelineMs = Math.max(this.local.timelineMs, c.endMs);
      }
      if (recoveredPartial) {
        this.local.recoveredAt = Date.now();
        await localStore.putSession(this.local);
      }
    }
    const chunks = await localStore.listChunks(this.sessionId);
    const pendingTurns = await localStore.listPendingTurns(this.sessionId);
    await this.sync.refreshCounts();
    this.baseMs = this.local?.timelineMs ?? 0;
    this.clock.set({ timelineMs: this.baseMs, level: 0, speaking: false });
    this.store.set({
      phase: "recovery",
      recovery: {
        localChunks: chunks.length,
        unsyncedChunks: chunks.filter((c) => !c.synced).length,
        recoveredPartialChunks: recoveredPartial,
        pendingTurns: pendingTurns.length,
        lastTimelineMs: this.local?.timelineMs ?? 0,
        serverStatus,
        localFinalized: this.local?.finalized ?? false,
      },
    });
    // Start uploading what we already have while the user decides.
    this.sync.kick();
  }

  // ---------------------------------------------------------------------------
  // Timers, window events, wake lock
  // ---------------------------------------------------------------------------

  private startTimers() {
    this.stopTimers();
    this.heartbeatTimer = setInterval(() => {
      const phase = this.store.get().phase;
      if (phase !== "recording" && phase !== "paused") return;
      void api(`/api/sessions/${this.sessionId}/heartbeat`, { body: { durationMs: this.timelineMs() } }).catch(
        () => undefined,
      );
      void this.checkpoint();
    }, HEARTBEAT_MS);
  }

  private stopTimers() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private eventsBound = false;

  private bindWindowEvents() {
    if (typeof window === "undefined" || this.eventsBound) return;
    this.eventsBound = true;
    const onOnline = () => {
      this.store.set({ online: true });
      this.notice("accent", "Conexión recuperada. Sincronizando.");
      this.sync.kick();
      this.realtime?.retryNow();
      this.refreshTranscriptionStatus();
    };
    const onOffline = () => {
      this.store.set({ online: false });
      this.notice("warning", "Sin conexión. Seguimos grabando en este dispositivo.");
      this.refreshTranscriptionStatus();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const phase = this.store.get().phase;
      if (phase === "recording" || phase === "paused" || phase === "finalizing") {
        e.preventDefault();
      }
    };
    const onPageHide = () => void this.checkpoint();
    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        void this.checkpoint();
        return;
      }
      void this.capture?.resume();
      void this.requestWakeLock();
      if (this.store.get().phase === "recording" && this.capture && !this.capture.live) void this.onMicLost();
    };
    const onDeviceChange = () => {
      if (this.store.get().phase === "recording" && this.capture && !this.capture.live) void this.onMicLost();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    this.cleanupFns.push(() => {
      this.eventsBound = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
    });
  }

  private async requestWakeLock() {
    if (this.store.get().phase !== "recording" && this.store.get().phase !== "starting") return;
    if (!("wakeLock" in navigator) || this.wakeLockSentinel) return;
    try {
      this.wakeLockSentinel = await navigator.wakeLock.request("screen");
      this.store.set({ wakeLock: true });
      this.wakeLockSentinel.addEventListener("release", () => {
        this.wakeLockSentinel = null;
        this.store.set({ wakeLock: false });
      });
    } catch {
      /* not allowed (battery saver, background) */
    }
  }

  private async releaseWakeLock() {
    try {
      await this.wakeLockSentinel?.release();
    } catch {
      /* ignore */
    }
    this.wakeLockSentinel = null;
    this.store.set({ wakeLock: false });
  }

  notice(tone: Notice["tone"], text: string) {
    if (this.disposed) return;
    const n: Notice = { id: ++this.noticeId, tone, text, at: Date.now() };
    this.store.set((p) => ({ notices: [...p.notices.slice(-7), n] }));
  }

  dismissNotice(id: number) {
    this.store.set((p) => ({ notices: p.notices.filter((n) => n.id !== id) }));
  }
}
