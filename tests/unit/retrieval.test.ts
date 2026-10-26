import { describe, expect, it } from "vitest";
import { contentTerms } from "@/lib/chat/retrieval";
import { restoreRefTokens } from "@/components/lecture/section-editor";

describe("retrieval query terms", () => {
  it("drops Spanish/English function words and keeps the content words in order", () => {
    expect(contentTerms("¿Qué explicó el profesor sobre la diapositiva 4 de slides-brussels.pptx?")).toEqual([
      "diapositiva",
      "4",
      "slides",
      "brussels",
      "pptx",
    ]);
    expect(contentTerms("What did the lecturer say about Article 7 and lis pendens?")).toEqual([
      "article",
      "7",
      "lis",
      "pendens",
    ]);
  });
  it("deduplicates and caps the number of terms", () => {
    expect(contentTerms("foro foro foro domicilio")).toEqual(["foro", "domicilio"]);
    expect(contentTerms(Array.from({ length: 30 }, (_, i) => `término${i}`).join(" "), 5)).toHaveLength(5);
  });
  it("returns nothing for a question made only of stopwords", () => {
    expect(contentTerms("¿Qué dijo?")).toEqual([]);
  });
});

describe("section editor markdown round-trip", () => {
  it("restores ref tokens the serializer escaped", () => {
    expect(restoreRefTokens("Texto \\[\\[ref:12-18\\]\\] y \\[\\[ref:3-3]] y [[ref:1-2]]")).toBe(
      "Texto [[ref:12-18]] y [[ref:3-3]] y [[ref:1-2]]",
    );
  });
});
