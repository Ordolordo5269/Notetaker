import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { markdownToBlocks, inlinesText } from "@/lib/export/blocks";
import { buildPdfDefinition } from "@/lib/export/pdf";
import { renderDocxBuffer } from "@/lib/export/docx";
import { studyDocToExport, transcriptToExport } from "@/lib/export";
import type { StudyDocumentContent } from "@/lib/notes/types";

const require = createRequire(import.meta.url);

const content: StudyDocumentContent = {
  version: 1,
  title: "Jurisdiction under Brussels I bis",
  language: "es",
  sections: [
    {
      id: "scope",
      heading: "Ámbito de aplicación",
      level: 1,
      markdown:
        "El Reglamento se aplica en **materia civil y mercantil** [[ref:3-5]].\n\n- Excluye materia fiscal y aduanera [[ref:4-4]]\n- Excluye *acta iure imperii*\n\n| Incluido | Excluido |\n|---|---|\n| Contratos | Arbitraje |\n\n> El profesor insistió en distinguir foro y ley aplicable [[ref:1-2]].\n\n### Un subapartado\n\nTexto con `código` y una referencia desconocida [[ref:900-901]].",
      refs: [
        { seqFrom: 1, seqTo: 2, startMs: 0, endMs: 62_400 },
        { seqFrom: 3, seqTo: 5, startMs: 62_400, endMs: 140_000 },
        { seqFrom: 4, seqTo: 4, startMs: 90_000, endMs: 110_000 },
      ],
      ambiguities: ["No quedó claro si mencionó el art. 1.2.d)."],
    },
    {
      id: "rule",
      heading: "Regla general",
      level: 2,
      markdown: "Domicilio del demandado.",
      refs: [],
      ambiguities: [],
      edited: true,
    },
  ],
  meta: {
    generatedAt: 1_793_000_000_000,
    model: "gpt-6.1-sol",
    uncovered: ["Caso Owusu"],
    gaps: [],
    wordCount: 60,
    sourceSegments: 38,
    attachments: ["slides-brussels.pdf"],
  },
};
const lecture = {
  title: "Clase 3 · Brussels I bis",
  subject: "Private International Law",
  date: "26 oct 2026",
  duration: "18 min",
};

describe("markdown → blocks", () => {
  it("keeps structure, resolves ref tokens and drops unknown ones", () => {
    const blocks = markdownToBlocks(content.sections[0]!.markdown, content.sections[0]!.refs);
    const types = blocks.map((b) => b.type);
    expect(types).toEqual(["paragraph", "list", "table", "quote", "heading", "paragraph"]);
    const first = blocks[0]!;
    if (first.type !== "paragraph") throw new Error("expected paragraph");
    expect(first.inlines.some((i) => i.bold && i.text === "materia civil y mercantil")).toBe(true);
    expect(first.inlines.find((i) => i.ref)?.text).toBe("01:02–02:20");
    const last = blocks[5]!;
    if (last.type !== "paragraph") throw new Error("expected paragraph");
    expect(inlinesText(last.inlines)).toBe("Texto con código y una referencia desconocida.");
    expect(last.inlines.some((i) => i.code && i.text === "código")).toBe(true);
    const table = blocks[2]!;
    if (table.type !== "table") throw new Error("expected table");
    expect(table.rows.map((r) => r.map(inlinesText))).toEqual([
      ["Incluido", "Excluido"],
      ["Contratos", "Arbitraje"],
    ]);
  });
});

describe("PDF export", () => {
  it("renders a parseable PDF with title, TOC, sections, provenance and footer", async () => {
    const doc = studyDocToExport(content, lecture, { kindLabel: "Apuntes completos" });
    const def = buildPdfDefinition(doc, { font: "Geist" });
    const pdfmake = require("pdfmake") as typeof import("pdfmake");
    const font = (f: string) => path.resolve("public/fonts", f);
    pdfmake.addFonts({
      Geist: {
        normal: font("Geist-Regular.ttf"),
        bold: font("Geist-Bold.ttf"),
        italics: font("Geist-Italic.ttf"),
        bolditalics: font("Geist-BoldItalic.ttf"),
      },
    });
    pdfmake.setUrlAccessPolicy(() => false);
    pdfmake.setLocalAccessPolicy((p) => p.startsWith(path.resolve("public/fonts")));
    const buffer = await pdfmake.createPdf(def).getBuffer();
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    const { extractText } = await import("unpdf");
    const parsed = await extractText(new Uint8Array(buffer), { mergePages: true });
    const text = parsed.text.replace(/\s+/g, " ");
    expect(parsed.totalPages).toBeGreaterThanOrEqual(2); // title+TOC page, then body
    expect(text).toContain("Jurisdiction under Brussels I bis");
    expect(text).toContain("Índice");
    expect(text).toContain("Ámbito de aplicación");
    expect(text).toContain("materia civil y mercantil");
    expect(text).toContain("01:02–02:20");
    expect(text).toContain("Editado manualmente");
    expect(text).toContain("Caso Owusu");
    expect(text).toMatch(/StudyFlow · Clase 3/);
  });

  it("exports the transcript in original and clean modes", () => {
    const segs = [
      {
        seq: 0,
        text: "Good morning everyone.",
        startMs: 0,
        endMs: 2000,
        status: "final" as const,
        language: "en" as const,
      },
      {
        seq: 1,
        text: "Hoy vemos competencia judicial.",
        startMs: 2000,
        endMs: 5000,
        status: "final" as const,
        language: "es" as const,
      },
      { seq: 2, text: "", startMs: 5000, endMs: 9000, status: "gap" as const, language: "und" as const },
    ];
    const original = transcriptToExport(lecture, segs, { clean: false });
    expect(original.sections[0]!.blocks).toHaveLength(3);
    const clean = transcriptToExport(lecture, segs, { clean: true });
    expect(clean.sections[0]!.blocks.length).toBeGreaterThanOrEqual(2);
    const def = buildPdfDefinition(original, { font: "Geist" });
    expect(JSON.stringify(def.content)).toContain("tramo sin grabación");
  });
});

describe("DOCX export", () => {
  it("renders a .docx whose text contains the sections, lists and table", async () => {
    const doc = studyDocToExport(content, lecture, { kindLabel: "Apuntes completos" });
    const buffer = await renderDocxBuffer(doc);
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer });
    const text = value.replace(/\s+/g, " ");
    expect(text).toContain("Jurisdiction under Brussels I bis");
    expect(text).toContain("Ámbito de aplicación");
    expect(text).toContain("Excluye materia fiscal y aduanera");
    expect(text).toContain("Contratos");
    expect(text).toContain("01:02–02:20");
    expect(text).toContain("Un subapartado");
    expect(text).toContain("Pasajes ambiguos");
  });
});
