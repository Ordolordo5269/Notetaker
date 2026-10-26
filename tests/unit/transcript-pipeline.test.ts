import { describe, expect, it } from "vitest";
import { consolidate, normalizeRefs, renderRange, renderRanges, type SourceSegment } from "@/lib/notes/transcript";
import { documentPlainText, countWords } from "@/lib/notes/types";

function seg(seq: number, text: string, startS: number, language: SourceSegment["language"] = "es"): SourceSegment {
  return { seq, text, status: "final", startMs: startS * 1000, endMs: (startS + 5) * 1000, language };
}

describe("consolidate", () => {
  it("orders by audio time, splits blocks with overlap and detects gaps", () => {
    const segments: SourceSegment[] = [];
    for (let i = 0; i < 120; i++) segments.push(seg(i, "palabra ".repeat(60).trim(), i * 6, i % 3 === 0 ? "en" : "es"));
    // Out-of-order arrival and a gap segment plus a two-minute jump.
    segments.reverse();
    segments.push({ seq: 500, text: "Intervalo no grabado", status: "gap", startMs: 300_000, endMs: 300_000, language: "und" });
    segments.push(seg(600, "después del salto", 1000));
    const t = consolidate(segments);
    expect(t.segments[0]!.seq).toBe(0);
    expect(t.blocks.length).toBeGreaterThan(1);
    for (let i = 1; i < t.blocks.length; i++) {
      // Each block starts inside the previous one (overlap) and advances.
      expect(t.blocks[i]!.seqFrom).toBeLessThanOrEqual(t.blocks[i - 1]!.seqTo);
      expect(t.blocks[i]!.seqFrom).toBeGreaterThan(t.blocks[i - 1]!.seqFrom);
    }
    expect(t.gaps.some((g) => g.includes("Intervalo no grabado"))).toBe(true);
    expect(t.gaps.some((g) => g.includes("Salto de"))).toBe(true);
    expect(t.dominantLanguage).toBe("es");
    expect(t.languages).toEqual(["es", "en"]);
  });

  it("renders ranges with citation markers and respects the token budget", () => {
    const segments = [seg(0, "Primera frase.", 0), seg(1, "Segunda frase.", 5), seg(2, "Tercera.", 10)];
    expect(renderRange(segments, 1, 2)).toBe("⟦s1 00:00:05⟧ Segunda frase.\n⟦s2 00:00:10⟧ Tercera.");
    const limited = renderRanges(segments, [{ seqFrom: 0, seqTo: 2 }], 12);
    expect(limited.split("\n").length).toBeLessThan(3);
  });
});

describe("normalizeRefs", () => {
  const segments = [seg(10, "a", 100), seg(11, "b", 105), seg(12, "c", 110), seg(20, "d", 200)];

  it("canonicalises tokens and markers and resolves times", () => {
    const { markdown, refs } = normalizeRefs("Texto ⟦s10 00:01:40⟧ más [[ref:11-12]] y [[ref: s20 ]] y [[ref:99]]", segments);
    expect(markdown).toBe("Texto [[ref:10-10]] más [[ref:11-12]] y [[ref:20-20]] y ");
    expect(refs.map((r) => `${r.seqFrom}-${r.seqTo}`)).toEqual(["10-10", "11-12", "20-20"]);
    expect(refs[1]).toMatchObject({ startMs: 105_000, endMs: 115_000 });
  });

  it("snaps a range to existing segments when the endpoints are missing", () => {
    const { refs } = normalizeRefs("[[ref:9-13]]", segments);
    expect(refs[0]).toMatchObject({ seqFrom: 10, seqTo: 12 });
  });
});

describe("document helpers", () => {
  it("counts words and strips refs for search text", () => {
    expect(countWords("Hola, mundo. It's fine — 24 artículos")).toBe(6);
    const text = documentPlainText({
      version: 1,
      title: "T",
      language: "es",
      sections: [{ id: "a", heading: "Intro", level: 1, markdown: "**Hola** [[ref:1-2]] mundo", refs: [], ambiguities: [] }],
      meta: { generatedAt: 0, model: null, uncovered: [], gaps: [], wordCount: 0, sourceSegments: 0, attachments: [] },
    });
    expect(text).toBe("Intro Hola mundo");
  });
});
