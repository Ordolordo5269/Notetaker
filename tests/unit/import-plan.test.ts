import { describe, expect, it } from "vitest";
import { extensionForMime, parseSilences, pickOutput, planSegments } from "@/lib/import/plan";
import { cleanTerm, mergeVocabulary } from "@/lib/data/vocabulary";

describe("import segment planning", () => {
  it("cuts in the longest pause of each window and never overlaps", () => {
    const silences = [
      { start: 25.0, end: 25.4 },
      { start: 33.1, end: 34.3 }, // longest pause in the first window → cut here
      { start: 40.0, end: 40.3 },
      { start: 62.0, end: 62.9 },
    ];
    const plan = planSegments(95, silences);
    expect(plan[0]).toEqual({ start: 0, end: 33.7 });
    expect(plan[1]!.start).toBe(33.7);
    expect(plan[1]!.end).toBe(62.45);
    expect(plan[plan.length - 1]!.end).toBe(95);
    for (let i = 1; i < plan.length; i++) expect(plan[i]!.start).toBe(plan[i - 1]!.end);
    for (const s of plan.slice(0, -1)) expect(s.end - s.start).toBeGreaterThanOrEqual(18);
    for (const s of plan) expect(s.end - s.start).toBeLessThanOrEqual(42);
  });

  it("falls back to the target length without pauses and merges a tiny tail", () => {
    const plan = planSegments(63, []);
    expect(plan.map((s) => [s.start, s.end])).toEqual([
      [0, 30],
      [30, 63],
    ]);
    expect(planSegments(20, [])).toEqual([{ start: 0, end: 20 }]);
    expect(planSegments(0, [])).toEqual([]);
    // 3295 s voice memo with no usable pauses → 30 s chunks, last one absorbs the 25 s tail.
    const long = planSegments(3295.7, []);
    expect(long.length).toBe(110);
    expect(long[long.length - 1]!.end).toBe(3295.7);
  });

  it("parses ffmpeg silencedetect output", () => {
    const log = [
      "[silencedetect @ 0x1] silence_start: 342.434",
      "[silencedetect @ 0x1] silence_end: 343.451 | silence_duration: 1.0169",
      "frame=  1 fps=0.0",
      "[silencedetect @ 0x1] silence_start: 345.71",
      "[silencedetect @ 0x1] silence_end: 346.854 | silence_duration: 1.14383",
    ].join("\n");
    expect(parseSilences(log)).toEqual([
      { start: 342.434, end: 343.451 },
      { start: 345.71, end: 346.854 },
    ]);
  });

  it("copies AAC, MP3, Opus and PCM streams and re-encodes the rest", () => {
    expect(pickOutput("aac")).toEqual({ ext: "m4a", mime: "audio/mp4", copy: true });
    expect(pickOutput("mp3")).toEqual({ ext: "mp3", mime: "audio/mpeg", copy: true });
    expect(pickOutput("opus")).toEqual({ ext: "ogg", mime: "audio/ogg", copy: true });
    expect(pickOutput("pcm_s16le")).toEqual({ ext: "wav", mime: "audio/wav", copy: true });
    expect(pickOutput("alac").copy).toBe(false);
    expect(pickOutput(null).copy).toBe(false);
    expect(extensionForMime("audio/mp4;codecs=mp4a")).toBe("m4a");
  });
});

describe("learned vocabulary", () => {
  it("keeps the user's terms first, deduplicates ignoring accents and case, and caps the list", () => {
    const merged = mergeVocabulary(
      ["Convenios de Ginebra", "ius cogens"],
      ["convenios de ginebra", "Customary international law", "IUS COGENS", "Article 38(1) ICJ Statute", "el", "12"],
      4,
    );
    expect(merged).toEqual([
      "Convenios de Ginebra",
      "ius cogens",
      "Customary international law",
      "Article 38(1) ICJ Statute",
    ]);
  });

  it("drops junk terms", () => {
    expect(cleanTerm("the")).toBeNull();
    expect(cleanTerm("2024")).toBeNull();
    expect(cleanTerm("a")).toBeNull();
    expect(cleanTerm("one two three four five six seven eight nine")).toBeNull();
    expect(cleanTerm("Artículo 24 del Reglamento Bruselas I bis")).toBe("Artículo 24 del Reglamento Bruselas I bis");
    expect(cleanTerm(" Geneva Conventions. ")).toBe("Geneva Conventions");
    expect(cleanTerm("x".repeat(61))).toBeNull();
  });
});
