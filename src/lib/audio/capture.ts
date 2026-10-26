// Microphone capture: one MediaStream shared by the persistent recorder
// (MediaRecorder) and the transcription path (AudioWorklet → PCM16 24 kHz).

export const PCM_SAMPLE_RATE = 24000;

export interface PcmFrame {
  /** Mono PCM16 little-endian samples at PCM_SAMPLE_RATE. */
  pcm: Int16Array;
  rms: number;
  peak: number;
}

export interface CaptureOptions {
  deviceId?: string | null;
  /** Browser noise suppression. Off by default: far-field lecture audio suffers from it. */
  noiseSuppression?: boolean;
  onFrame: (frame: PcmFrame) => void;
  onTrackEnded: () => void;
}

export type MicPermissionState = "granted" | "denied" | "prompt" | "unsupported";

export class CaptureError extends Error {
  constructor(
    public readonly code: "unsupported" | "denied" | "not_found" | "in_use" | "worklet" | "unknown",
    message: string,
  ) {
    super(message);
    this.name = "CaptureError";
  }
}

export function captureSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof AudioContext !== "undefined" &&
    typeof AudioWorkletNode !== "undefined" &&
    typeof MediaRecorder !== "undefined"
  );
}

export async function queryMicPermission(): Promise<MicPermissionState> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return "prompt";
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return status.state as MicPermissionState;
  } catch {
    return "prompt";
  }
}

export interface MicDevice {
  deviceId: string;
  label: string;
}

export async function listMicrophones(): Promise<MicDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "audioinput")
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Micrófono ${i + 1}` }));
}

function mapGetUserMediaError(err: unknown): CaptureError {
  const name = (err as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new CaptureError("denied", "Permiso de micrófono denegado. Actívalo en los ajustes del navegador.");
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return new CaptureError("not_found", "No se encontró ningún micrófono.");
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return new CaptureError("in_use", "El micrófono está en uso por otra aplicación o no responde.");
  }
  return new CaptureError("unknown", `No se pudo acceder al micrófono (${name || "error desconocido"}).`);
}

export class MicCapture {
  readonly stream: MediaStream;
  readonly context: AudioContext;
  private readonly source: MediaStreamAudioSourceNode;
  private readonly node: AudioWorkletNode;
  private closed = false;

  private constructor(stream: MediaStream, context: AudioContext, node: AudioWorkletNode) {
    this.stream = stream;
    this.context = context;
    this.node = node;
    this.source = context.createMediaStreamSource(stream);
    this.source.connect(node);
    // Keep the graph alive without producing output.
    const sink = context.createGain();
    sink.gain.value = 0;
    node.connect(sink);
    sink.connect(context.destination);
  }

  static async open(opts: CaptureOptions): Promise<MicCapture> {
    if (!captureSupported()) {
      throw new CaptureError("unsupported", "Este navegador no permite grabar audio con las funciones necesarias.");
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(opts.deviceId ? { deviceId: { exact: opts.deviceId } } : {}),
          channelCount: { ideal: 1 },
          echoCancellation: false,
          autoGainControl: true,
          noiseSuppression: opts.noiseSuppression ?? false,
        },
        video: false,
      });
    } catch (err) {
      throw mapGetUserMediaError(err);
    }

    let context: AudioContext;
    try {
      // 24 kHz directly when the browser allows it (Chrome, Safari ≥ 14.1):
      // the browser then resamples with a proper filter.
      context = new AudioContext({ sampleRate: PCM_SAMPLE_RATE, latencyHint: "playback" });
    } catch {
      context = new AudioContext({ latencyHint: "playback" });
    }
    try {
      if (context.state === "suspended") await context.resume();
      await context.audioWorklet.addModule("/worklets/pcm-processor.js");
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      await context.close().catch(() => undefined);
      throw new CaptureError("worklet", `No se pudo iniciar el procesador de audio (${(err as Error).message}).`);
    }
    const node = new AudioWorkletNode(context, "pcm-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      processorOptions: { targetRate: PCM_SAMPLE_RATE },
    });
    node.port.onmessage = (e: MessageEvent<{ type: string; pcm: ArrayBuffer; rms: number; peak: number }>) => {
      if (e.data?.type === "frame") {
        opts.onFrame({ pcm: new Int16Array(e.data.pcm), rms: e.data.rms, peak: e.data.peak });
      }
    };
    const capture = new MicCapture(stream, context, node);
    for (const track of stream.getAudioTracks()) {
      track.addEventListener("ended", () => {
        if (!capture.closed) opts.onTrackEnded();
      });
    }
    return capture;
  }

  get deviceLabel(): string {
    return this.stream.getAudioTracks()[0]?.label ?? "";
  }

  get deviceId(): string | null {
    return this.stream.getAudioTracks()[0]?.getSettings().deviceId ?? null;
  }

  get live(): boolean {
    return !this.closed && this.stream.getAudioTracks().some((t) => t.readyState === "live");
  }

  /** Mute transcription frames (recorder keeps running). */
  setMuted(muted: boolean) {
    this.node.port.postMessage({ type: "mute", value: muted });
  }

  async resume() {
    if (this.context.state === "suspended") await this.context.resume();
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.node.port.onmessage = null;
    this.stream.getTracks().forEach((t) => t.stop());
    try {
      this.source.disconnect();
      this.node.disconnect();
    } catch {
      /* already disconnected */
    }
    await this.context.close().catch(() => undefined);
  }
}

/** Pick the MediaRecorder MIME type this browser can actually produce. */
export function pickRecorderMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}
