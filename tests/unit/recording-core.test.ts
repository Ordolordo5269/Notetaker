import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { VoiceActivityDetector } from "@/lib/audio/vad";
import { pcm16ToWav, concatPcm16 } from "@/lib/audio/wav";
import { buildParagraphs, removeFillers, transcriptToMarkdown } from "@/lib/transcription/clean";
import { buildTranscriptionSession, sanitizeKeywords } from "@/lib/transcription/session-config";
import { SESSION_TRANSITIONS, canTransition, isInterrupted } from "@/lib/sessions/state-machine";
import { missingSequences } from "@/lib/data/lectures";
import { audioCost, tokenCost } from "@/lib/cost/pricing";
import { emailAllowed } from "@/lib/auth/accounts";

describe("VoiceActivityDetector", () => {
  it("opens a turn on sustained speech and closes it after the hangover", () => {
    const vad = new VoiceActivityDetector({ hangoverMs: 800, minSpeechMs: 200 });
    const events: string[] = [];
    // 2 s of room noise, 3 s of speech, 1.5 s of silence.
    for (let i = 0; i < 20; i++) events.push(vad.push(0.003)?.type ?? "");
    for (let i = 0; i < 30; i++) events.push(vad.push(0.08)?.type ?? "");
    for (let i = 0; i < 15; i++) events.push(vad.push(0.003)?.type ?? "");
    const starts = events.filter((e) => e === "speech_start").length;
    const ends = events.filter((e) => e === "speech_end").length;
    expect(starts).toBe(1);
    expect(ends).toBe(1);
    expect(events.indexOf("speech_start")).toBe(21); // second speech frame (200 ms)
    expect(events.indexOf("speech_end")).toBe(57); // 8 silent frames after speech
  });

  it("ignores a single click and cuts a long monologue", () => {
    const vad = new VoiceActivityDetector({ softMaxMs: 20_000, hardMaxMs: 30_000 });
    expect(vad.push(0.2)).toBeNull();
    expect(vad.push(0.003)).toBeNull();
    const ev: string[] = [];
    for (let i = 0; i < 320; i++) ev.push(vad.push(0.1)?.type ?? "");
    expect(ev.filter((e) => e === "speech_end").length).toBeGreaterThanOrEqual(1);
    expect(ev.indexOf("speech_end")).toBeLessThanOrEqual(301);
  });
});

describe("wav", () => {
  it("writes a valid 24 kHz mono PCM16 header", async () => {
    const wav = pcm16ToWav([new Int16Array([1, -1, 0, 32767])], 24000);
    const buf = Buffer.from(await wav.arrayBuffer());
    expect(buf.toString("ascii", 0, 4)).toBe("RIFF");
    expect(buf.readUInt32LE(24)).toBe(24000);
    expect(buf.readUInt16LE(22)).toBe(1);
    expect(buf.readUInt32LE(40)).toBe(8);
    expect(concatPcm16([new Int16Array([1, 2]), new Int16Array([3])])).toEqual(new Int16Array([1, 2, 3]));
  });
});

describe("clean transcript", () => {
  it("removes hesitation sounds but keeps words and language", () => {
    expect(removeFillers("eh, hoy vamos a ver, mm, el artículo 24")).toBe("Hoy vamos a ver, el artículo 24");
    expect(removeFillers("So, um, the court, uh, decided")).toBe("So, the court, decided");
    // Not fillers: real words that merely start with the same letters.
    expect(removeFillers("Ehrlich wrote about it")).toBe("Ehrlich wrote about it");
    expect(removeFillers("Este tribunal decidió")).toBe("Este tribunal decidió");
  });

  it("builds paragraphs on long pauses and language changes", () => {
    const segs = [
      {
        seq: 0,
        text: "Today we study jurisdiction.",
        startMs: 0,
        endMs: 3000,
        status: "final" as const,
        language: "en" as const,
      },
      {
        seq: 1,
        text: "Article 24 is exclusive.",
        startMs: 3500,
        endMs: 6000,
        status: "final" as const,
        language: "en" as const,
      },
      {
        seq: 2,
        text: "Esto significa que primero miramos los foros exclusivos.",
        startMs: 6500,
        endMs: 9000,
        status: "final" as const,
        language: "es" as const,
      },
      {
        seq: 3,
        text: "Intervalo no grabado",
        startMs: 9000,
        endMs: 9000,
        status: "gap" as const,
        language: "und" as const,
      },
      {
        seq: 4,
        text: "Back to English.",
        startMs: 20000,
        endMs: 22000,
        status: "final" as const,
        language: "en" as const,
      },
    ];
    const p = buildParagraphs(segs);
    expect(p.map((x) => x.seqFrom)).toEqual([0, 2, 3, 4]);
    expect(p[0]!.text).toBe("Today we study jurisdiction. Article 24 is exclusive.");
    expect(p[2]!.gap).toBe(true);
    const md = transcriptToMarkdown("Clase", { subject: "PIL" }, segs);
    expect(md).toContain("# Clase");
    expect(md).toContain("Esto significa");
    expect(md).toContain("> 00:09 — Intervalo no grabado");
  });
});

describe("transcription session config", () => {
  it("sanitises keywords per the API rules and never fixes a single language", () => {
    expect(sanitizeKeywords(["Brussels I bis", "a<b>c\nd", "  ", "Brussels I bis", "x".repeat(200)])).toEqual([
      "Brussels I bis",
      "a b c d",
      "x".repeat(80),
    ]);
    const session = buildTranscriptionSession(
      "gpt-live-transcribe",
      { keywords: ["Article 24"], subjectName: "PIL" },
      "medium",
    );
    expect(session.audio.input.transcription.languages).toEqual(["es", "en"]);
    expect("language" in session.audio.input.transcription).toBe(false);
    expect(session.audio.input.turn_detection).toBeNull();
    expect(session.audio.input.transcription.prompt).not.toMatch(/[<>]/);
  });
});

describe("session state machine", () => {
  it("matches the transition table in the SQL migration", () => {
    const sql = fs.readFileSync(path.resolve(__dirname, "../../migrations/0001_init.sql"), "utf8");
    const block = sql.slice(
      sql.indexOf("INSERT INTO session_status_transitions"),
      sql.indexOf("CREATE TRIGGER lecture_sessions_status_guard"),
    );
    const inSql = new Set([...block.matchAll(/\('(\w+)', '(\w+)'\)/g)].map((m) => `${m[1]}->${m[2]}`));
    const inCode = new Set<string>();
    for (const [from, tos] of Object.entries(SESSION_TRANSITIONS)) for (const to of tos) inCode.add(`${from}->${to}`);
    expect([...inCode].sort()).toEqual([...inSql].sort());
  });

  it("never allows reopening a ready lecture", () => {
    expect(canTransition("ready", "recording")).toBe(false);
    expect(canTransition("recording", "finalizing")).toBe(true);
    expect(isInterrupted("recording", Date.now() - 120_000)).toBe(true);
    expect(isInterrupted("recording", Date.now() - 10_000)).toBe(false);
    expect(isInterrupted("ready", null)).toBe(false);
  });
});

describe("helpers", () => {
  it("finds missing chunk sequences", () => {
    expect(missingSequences([0, 1, 3], 5)).toEqual([2, 4]);
    expect(missingSequences([], 0)).toEqual([]);
  });

  it("estimates costs from the pricing table", () => {
    expect(audioCost("gpt-live-transcribe", 60)).toBeCloseTo(0.017);
    expect(audioCost("gpt-transcribe", 5400)).toBeCloseTo(0.405);
    expect(tokenCost("gpt-6-luna", 100_000, 0, 0)).toBeCloseTo(0.01);
    expect(tokenCost("gpt-6.1-sol", 200_000, 100_000, 10_000)).toBeCloseTo(0.2 + 0.01 + 0.1);
    // Prompts over 272K tokens are billed at 2x input / 1.5x output.
    expect(tokenCost("gpt-6-luna", 1_000_000, 0, 0)).toBeCloseTo(0.2);
    // Unknown models use the conservative fallback instead of 0.
    expect(tokenCost("mystery-model", 1000, 0, 1000)).toBeGreaterThan(0);
  });

  it("evaluates sign-up allow lists", () => {
    expect(emailAllowed(["*"], "a@b.c")).toBe(true);
    expect(emailAllowed(["*@uni.es"], "lucas@uni.es")).toBe(true);
    expect(emailAllowed(["*@uni.es"], "lucas@gmail.com")).toBe(false);
    expect(emailAllowed(["x@y.z"], "x@y.z")).toBe(true);
  });
});

describe("finalize: sequences the server must have", () => {
  it("only sequences the client actually holds are expected (a recorder torn down before its first part is not)", async () => {
    const { missingFrom, missingSequences } = await import("@/lib/data/lectures");
    // Chunk 0 never produced data; the client holds 1-4 and the server has 1-4.
    expect(missingFrom([1, 2, 3, 4], [1, 2, 3, 4])).toEqual([]);
    expect(missingFrom([1, 2, 4], [1, 2, 3, 4])).toEqual([3]);
    expect(missingFrom([], [2, 2, 0])).toEqual([0, 2]);
    // Legacy contiguous check still flags the gap.
    expect(missingSequences([1, 2, 3, 4], 5)).toEqual([0]);
  });
});
