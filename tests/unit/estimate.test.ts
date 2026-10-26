import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { estimateNotesCost, estimateSectionCost } from "@/lib/notes/estimate";
import { consolidate } from "@/lib/notes/transcript";

const models = {
  notes: "gpt-6.1-sol",
  fast: "gpt-6-luna",
  chat: "gpt-6.1-sol",
  live: "gpt-live-transcribe",
  file: "gpt-transcribe",
  embedding: "text-embedding-3-small",
};

function fixture(file: string) {
  const f = JSON.parse(readFileSync(file, "utf8")) as { segments: { text: string; startS: number }[] };
  const segments = f.segments.map((s, i) => ({
    seq: i,
    text: s.text,
    startMs: Math.round(s.startS * 1000),
    endMs: Math.round(s.startS * 1000) + 20_000,
    status: "final" as const,
    language: "es" as const,
  }));
  const chars = f.segments.reduce((n, s) => n + s.text.length, 0);
  return { chars, blocks: consolidate(segments).blocks.length };
}

describe("notes cost estimate (calibrated against real runs)", () => {
  it("stays within a safe band of the measured cost: 18-minute class cost 0.36 $, 88-minute class 1.88 $", () => {
    const short = fixture("tests/fixtures/lecture-pil-transcript.json");
    const long = fixture("tests/fixtures/lecture-long-transcript.json");
    const e18 = estimateNotesCost(models, short.chars, 2500, short.blocks).usd;
    const e88 = estimateNotesCost(models, long.chars, 2500, long.blocks).usd;
    // Never below the measured cost (budgets rely on it), never more than 60 % above.
    expect(e18).toBeGreaterThanOrEqual(0.36);
    expect(e18).toBeLessThanOrEqual(0.36 * 1.6);
    expect(e88).toBeGreaterThanOrEqual(1.88);
    expect(e88).toBeLessThanOrEqual(1.88 * 1.6);
    expect(e88).toBeGreaterThan(e18 * 2.5);
  });

  it("grows with the lecture and with attachments, and a single section is a small fraction", () => {
    const a = estimateNotesCost(models, 20_000, 0, 2).usd;
    const b = estimateNotesCost(models, 80_000, 0, 10).usd;
    const c = estimateNotesCost(models, 80_000, 60_000, 10).usd;
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(estimateSectionCost(models, 12_000).usd).toBeLessThan(a / 4);
  });
});
