import { describe, expect, it } from "vitest";
import { energyProfile, extensionForMime, pickOutput, planSegments } from "@/lib/import/plan";
import { cleanTerm, mergeVocabulary } from "@/lib/data/vocabulary";

/** A loudness profile that is loud everywhere except in the given pauses (seconds, depth 0–1). */
function profileWith(duration: number, pauses: { at: number; length: number; depth?: number }[]) {
  const frameMs = 20;
  const energy = new Float32Array(Math.round((duration * 1000) / frameMs)).fill(1);
  for (const p of pauses) {
    const from = Math.round(((p.at - p.length / 2) * 1000) / frameMs);
    const to = Math.round(((p.at + p.length / 2) * 1000) / frameMs);
    for (let f = Math.max(0, from); f < Math.min(energy.length, to); f++) energy[f] = 1 - (p.depth ?? 1);
  }
  return { frameMs, energy };
}

describe("import segment planning", () => {
  it("cuts in the quietest moment of each window and never overlaps", () => {
    const profile = profileWith(95, [
      { at: 25.0, length: 0.4, depth: 0.5 },
      { at: 33.7, length: 1.2 }, // deepest pause in the first window → cut here
      { at: 40.0, length: 0.3, depth: 0.6 },
      { at: 62.45, length: 0.9 },
    ]);
    const plan = planSegments(95, profile);
    expect(plan[0]!.start).toBe(0);
    expect(plan[0]!.end).toBeGreaterThan(33.1);
    expect(plan[0]!.end).toBeLessThan(34.3);
    expect(plan[1]!.start).toBe(plan[0]!.end);
    expect(plan[1]!.end).toBeGreaterThan(62.0);
    expect(plan[1]!.end).toBeLessThan(62.9);
    expect(plan[plan.length - 1]!.end).toBe(95);
    for (let i = 1; i < plan.length; i++) expect(plan[i]!.start).toBe(plan[i - 1]!.end);
    for (const s of plan.slice(0, -1)) expect(s.end - s.start).toBeGreaterThanOrEqual(18);
    for (const s of plan) expect(s.end - s.start).toBeLessThanOrEqual(42);
  });

  it("prefers the target length among equally quiet moments", () => {
    const profile = profileWith(80, [
      { at: 20, length: 1 },
      { at: 29.5, length: 1 },
      { at: 41, length: 1 },
    ]);
    const plan = planSegments(80, profile);
    expect(plan[0]!.end).toBeGreaterThan(29);
    expect(plan[0]!.end).toBeLessThan(30);
  });

  it("falls back to the target length without a profile and merges a tiny tail", () => {
    const plan = planSegments(63, null);
    expect(plan.map((s) => [s.start, s.end])).toEqual([
      [0, 30],
      [30, 63],
    ]);
    expect(planSegments(20, null)).toEqual([{ start: 0, end: 20 }]);
    expect(planSegments(0, null)).toEqual([]);
    // 3295 s voice memo with no usable profile → 30 s chunks, last one absorbs the 25 s tail.
    const long = planSegments(3295.7, null);
    expect(long.length).toBe(110);
    expect(long[long.length - 1]!.end).toBe(3295.7);
  });

  it("builds a loudness profile whose minimum sits in the silent gap", () => {
    const rate = 4000;
    const samples = new Int16Array(rate * 3);
    for (let i = 0; i < samples.length; i++) {
      const t = i / rate;
      const silent = t > 1.2 && t < 1.8;
      samples[i] = silent ? 0 : Math.round(8000 * Math.sin(i * 0.3));
    }
    const profile = energyProfile(samples, rate);
    expect(profile.frameMs).toBe(20);
    expect(profile.energy.length).toBe(150);
    let minF = 0;
    for (let f = 0; f < profile.energy.length; f++) if (profile.energy[f]! < profile.energy[minF]!) minF = f;
    const minT = (minF * 20) / 1000;
    expect(minT).toBeGreaterThan(1.3);
    expect(minT).toBeLessThan(1.7);
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
