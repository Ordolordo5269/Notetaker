// Energy-based voice activity detection with an adaptive noise floor.
// Drives client-side turn segmentation: the Realtime transcription session
// runs with turn_detection = null, so the client decides when to commit.
//
// Tuned for a laptop on a desk and a lecturer a few metres away: generous
// hangover so pauses between clauses do not split a sentence, and a hard
// maximum so a long monologue still produces regular final transcripts.

export interface VadOptions {
  /** Frame duration in ms (the worklet emits 100 ms frames). */
  frameMs?: number;
  /** Silence needed to end a turn. */
  hangoverMs?: number;
  /** Speech needed to open a turn (filters clicks and coughs). */
  minSpeechMs?: number;
  /** Turns longer than this are cut at the next quiet frame. */
  softMaxMs?: number;
  /** Absolute cut, even mid-word. */
  hardMaxMs?: number;
  /** Multiplier over the noise floor that counts as speech. */
  speechRatio?: number;
  /** RMS below which a frame is always treated as silence. */
  absoluteFloor?: number;
}

export type VadEvent = { type: "speech_start" } | { type: "speech_end"; reason: "silence" | "soft_max" | "hard_max" };

export class VoiceActivityDetector {
  private readonly o: Required<VadOptions>;
  private noise = 0.004;
  private inSpeech = false;
  private speechMs = 0;
  private silenceMs = 0;
  private turnMs = 0;
  private recentSpeech: number[] = [];

  constructor(options: VadOptions = {}) {
    this.o = {
      frameMs: options.frameMs ?? 100,
      hangoverMs: options.hangoverMs ?? 800,
      minSpeechMs: options.minSpeechMs ?? 200,
      softMaxMs: options.softMaxMs ?? 20_000,
      hardMaxMs: options.hardMaxMs ?? 30_000,
      speechRatio: options.speechRatio ?? 2.2,
      absoluteFloor: options.absoluteFloor ?? 0.0025,
    };
  }

  get speaking(): boolean {
    return this.inSpeech;
  }

  get noiseFloor(): number {
    return this.noise;
  }

  /** Feed one frame's RMS; returns a turn boundary event when one occurs. */
  push(rms: number): VadEvent | null {
    const { frameMs } = this.o;
    const threshold = Math.max(this.o.absoluteFloor, this.noise * this.o.speechRatio);
    const isSpeech = rms > threshold;

    // Track the noise floor on quiet frames (fast down, slow up).
    if (!isSpeech) {
      this.noise = rms < this.noise ? this.noise * 0.8 + rms * 0.2 : this.noise * 0.98 + rms * 0.02;
    } else if (this.inSpeech && this.turnMs > 10_000) {
      // Long sustained "speech" with a low level is probably steady noise: creep up.
      this.noise = this.noise * 0.995 + rms * 0.005;
    }
    this.noise = Math.min(Math.max(this.noise, 0.0005), 0.2);

    if (!this.inSpeech) {
      if (isSpeech) {
        this.recentSpeech.push(frameMs);
        const total = this.recentSpeech.reduce((a, b) => a + b, 0);
        if (total >= this.o.minSpeechMs) {
          this.inSpeech = true;
          this.turnMs = total;
          this.silenceMs = 0;
          this.speechMs = total;
          this.recentSpeech = [];
          return { type: "speech_start" };
        }
      } else {
        this.recentSpeech = [];
      }
      return null;
    }

    this.turnMs += frameMs;
    if (isSpeech) {
      this.speechMs += frameMs;
      this.silenceMs = 0;
    } else {
      this.silenceMs += frameMs;
    }

    if (this.turnMs >= this.o.hardMaxMs) return this.end("hard_max");
    if (this.turnMs >= this.o.softMaxMs && (!isSpeech || this.silenceMs >= frameMs)) return this.end("soft_max");
    if (this.silenceMs >= this.o.hangoverMs) return this.end("silence");
    return null;
  }

  /** Force the current turn to end (pause, stop, reconnection). */
  flush(): VadEvent | null {
    return this.inSpeech ? this.end("hard_max") : null;
  }

  private end(reason: "silence" | "soft_max" | "hard_max"): VadEvent {
    this.inSpeech = false;
    this.turnMs = 0;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.recentSpeech = [];
    return { type: "speech_end", reason };
  }
}

/** Number of frames before a speech start that are kept so the first word is not clipped. */
export const PRE_ROLL_FRAMES = 4; // 400 ms
