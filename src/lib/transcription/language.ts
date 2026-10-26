// Lightweight Spanish/English identification on transcript text.
//
// gpt-live-transcribe does not return detected languages, so segment labels
// come from this heuristic (labelled "estimado" in the UI) unless a model
// prediction is available (gpt-transcribe returns `languages`). It never
// produces a confidence percentage, and it returns "und" when evidence is weak.
import type { SegmentLanguage } from "@/lib/db/schema";

const ES_WORDS = new Set(
  (
    "el la los las del que y en un una unos unas es son por para con lo al como más pero sus su le les ya este esta " +
    "estos estas esto ese esa eso aquel muy también hay sobre entre cuando todo todos toda ser fue era está están " +
    "estamos vamos hoy ahora porque pues entonces donde dónde qué cuál cómo cuando sí si sin hasta desde hacia " +
    "nosotros ustedes vosotros ellos ellas usted tiene tienen tenemos puede pueden podemos debe deben debemos " +
    "hacer hace hecho dice decir significa significa aquí allí así bien mismo misma otra otro otros otras cada " +
    "tanto tan algo nada nadie siempre nunca después antes luego también ejemplo artículo reglamento derecho ley " +
    "tribunal según caso casos excepción foros competencia aplicable vamos vale bueno o u e ni sino aunque mientras " +
    "nuestro nuestra vuestro"
  ).split(/\s+/),
);

const EN_WORDS = new Set(
  (
    "the of and to in is are was were be been that it for on with as this these those at by an we you they not or " +
    "from have has had which but can will would could should there their what so if about today going it's we're " +
    "they're don't doesn't isn't let's into than then when where who why how also because such other some any all " +
    "our your its do does did just here now very one two first second law court article regulation case cases " +
    "exception jurisdiction applicable rule rules means mean must may might under between within whether shall " +
    "said says say look let's okay right well"
  ).split(/\s+/),
);

// Words spelled identically in both languages carry no signal.
for (const w of ["a", "no", "me", "he", "son", "con", "has", "real", "general", "final", "total", "legal", "union"]) {
  ES_WORDS.delete(w);
  EN_WORDS.delete(w);
}

export interface LanguageScore {
  es: number;
  en: number;
}

export function scoreText(text: string): LanguageScore {
  let es = 0;
  let en = 0;
  if (/[ñ¿¡]/i.test(text)) es += 2;
  es += Math.min(3, (text.match(/[áéíóú]/gi) ?? []).length * 0.5);
  if (/\b\w+'(s|re|ve|ll|t|d|m)\b/i.test(text)) en += 1.5;
  const words = text.toLowerCase().match(/[a-záéíóúüñ']+/g) ?? [];
  for (const w of words) {
    if (ES_WORDS.has(w)) es += 1;
    if (EN_WORDS.has(w)) en += 1;
  }
  return { es, en };
}

function classify(score: LanguageScore, minEvidence: number): "es" | "en" | null {
  const { es, en } = score;
  if (Math.max(es, en) < minEvidence) return null;
  if (es >= en * 2 && es - en >= 1) return "es";
  if (en >= es * 2 && en - es >= 1) return "en";
  return null;
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?¿¡…;:])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Identify the language(s) of a transcript segment: "es", "en", "mixed" or "und". */
export function detectSegmentLanguage(text: string): SegmentLanguage {
  const sentences = splitSentences(text);
  const found = new Set<"es" | "en">();
  for (const s of sentences) {
    const lang = classify(scoreText(s), 2);
    if (lang) found.add(lang);
  }
  if (found.size === 2) return "mixed";
  if (found.size === 1) return [...found][0]!;
  return classify(scoreText(text), 2) ?? "und";
}

/** Map gpt-transcribe `languages` output to a segment label. */
export function languageFromModel(codes: readonly { code: string }[] | undefined): SegmentLanguage | null {
  if (!codes || codes.length === 0) return null;
  const norm = new Set(
    codes
      .map((c) => c.code.toLowerCase())
      .map((c) => (c.startsWith("es") || c === "spa" ? "es" : c.startsWith("en") || c === "eng" ? "en" : c)),
  );
  const es = norm.has("es");
  const en = norm.has("en");
  if (es && en) return "mixed";
  if (es) return "es";
  if (en) return "en";
  return null;
}

/**
 * Combine a model prediction with the text heuristic. The model returns a
 * single dominant language for code-switched audio, so a heuristic "mixed"
 * result is kept when the text clearly contains both languages.
 */
export function resolveSegmentLanguage(
  text: string,
  modelCodes?: readonly { code: string }[],
): { language: SegmentLanguage; source: "heuristic" | "model" } {
  const heuristic = detectSegmentLanguage(text);
  const model = languageFromModel(modelCodes);
  if (heuristic === "mixed") return { language: "mixed", source: "heuristic" };
  if (model) return { language: model, source: "model" };
  return { language: heuristic, source: "heuristic" };
}

/** Languages present in a lecture, ordered by frequency. */
export function lectureLanguages(counts: readonly { language: SegmentLanguage; count: number }[]): ("es" | "en")[] {
  let es = 0;
  let en = 0;
  for (const { language, count } of counts) {
    if (language === "es" || language === "mixed") es += count;
    if (language === "en" || language === "mixed") en += count;
  }
  const entries: ["es" | "en", number][] = [
    ["es", es],
    ["en", en],
  ];
  return entries
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang);
}
