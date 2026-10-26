import { describe, expect, it } from "vitest";
import {
  detectSegmentLanguage,
  languageFromModel,
  lectureLanguages,
  resolveSegmentLanguage,
} from "@/lib/transcription/language";

describe("detectSegmentLanguage", () => {
  it("labels English lecture speech as en", () => {
    expect(detectSegmentLanguage("Today we're going to study the Brussels I bis Regulation.")).toBe("en");
    expect(detectSegmentLanguage("Today we're studying international humanitarian law.")).toBe("en");
  });

  it("labels Spanish lecture speech as es", () => {
    expect(detectSegmentLanguage("Hoy vamos a estudiar el Reglamento Bruselas I bis.")).toBe("es");
    expect(detectSegmentLanguage("Hoy vamos a estudiar el derecho internacional humanitario.")).toBe("es");
  });

  it("labels code-switched speech as mixed", () => {
    expect(
      detectSegmentLanguage(
        "Article 24 establishes exclusive jurisdiction. Esto significa que debemos comprobar primero los foros exclusivos.",
      ),
    ).toBe("mixed");
    expect(
      detectSegmentLanguage("Article 24 establishes exclusive jurisdiction. Ahora vamos a ver una excepción."),
    ).toBe("mixed");
  });

  it("returns und when there is not enough evidence", () => {
    expect(detectSegmentLanguage("Bruselas I bis.")).toBe("und");
    expect(detectSegmentLanguage("")).toBe("und");
    expect(detectSegmentLanguage("Article 24.")).toBe("und");
  });
});

describe("model language codes", () => {
  it("maps gpt-transcribe languages", () => {
    expect(languageFromModel([{ code: "es" }])).toBe("es");
    expect(languageFromModel([{ code: "en" }, { code: "es" }])).toBe("mixed");
    expect(languageFromModel([])).toBeNull();
    expect(languageFromModel([{ code: "fr" }])).toBeNull();
  });

  it("keeps a heuristic 'mixed' over a single model language", () => {
    // gpt-transcribe returned [{code:"es"}] for this exact mixed sentence in a real API test.
    const text = "Article 24 establishes exclusive jurisdiction. Ahora vamos a ver una excepción.";
    expect(resolveSegmentLanguage(text, [{ code: "es" }])).toEqual({ language: "mixed", source: "heuristic" });
    expect(resolveSegmentLanguage("Hoy vamos a estudiar el derecho internacional.", [{ code: "es" }])).toEqual({
      language: "es",
      source: "model",
    });
  });

  it("orders lecture languages by frequency", () => {
    expect(
      lectureLanguages([
        { language: "en", count: 2 },
        { language: "es", count: 1 },
        { language: "mixed", count: 1 },
        { language: "und", count: 4 },
      ]),
    ).toEqual(["en", "es"]);
    expect(lectureLanguages([{ language: "und", count: 3 }])).toEqual([]);
  });
});
