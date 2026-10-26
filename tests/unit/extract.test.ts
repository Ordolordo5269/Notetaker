import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectKind, extractPages, pptxSlideText } from "@/lib/documents/extract";

const fixture = async (name: string) => {
  const buf = await readFile(path.resolve("tests/fixtures", name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
};

describe("attachment extraction", () => {
  it("extracts one entry per PDF page with its text", async () => {
    const r = await extractPages("pdf", await fixture("slides-brussels.pdf"));
    expect(r.pageCount).toBe(5);
    expect(r.pages.map((p) => p.page)).toEqual([1, 2, 3, 4, 5]);
    expect(r.pages[1]!.text).toContain("Scope of application (Art. 1)");
    expect(r.pages[3]!.text).toContain("Art. 7(2)");
    expect(r.needsOcr).toBe(false);
    expect(r.unit).toBe("página");
  });

  it("flags a PDF without a text layer as needing OCR instead of pretending", async () => {
    const r = await extractPages("pdf", await fixture("scanned-blank.pdf"));
    expect(r.pageCount).toBe(1);
    expect(r.pages).toEqual([]);
    expect(r.needsOcr).toBe(true);
  });

  it("extracts slides from a PPTX in slide order", async () => {
    const r = await extractPages("pptx", await fixture("slides-brussels.pptx"));
    expect(r.pageCount).toBe(5);
    expect(r.pages[0]!.text.split("\n")[0]).toBe("Brussels I bis Regulation (EU) 1215/2012");
    expect(r.pages[4]!.text).toContain("lis pendens");
    expect(r.unit).toBe("diapositiva");
  });

  it("splits a DOCX into paragraph-aligned fragments", async () => {
    const r = await extractPages("docx", await fixture("notes-brussels.docx"));
    expect(r.pageCount).toBeGreaterThanOrEqual(1);
    expect(r.pages.map((p) => p.text).join("\n")).toContain("actor sequitur forum rei");
    expect(r.unit).toBe("fragmento");
  });

  it("decodes XML entities and joins runs inside a paragraph", () => {
    const xml = `<a:p><a:r><a:t>Tom &amp; Jerry</a:t></a:r><a:r><a:t> &lt;3</a:t></a:r></a:p><a:p><a:r><a:t>Line 2</a:t></a:r></a:p>`;
    expect(pptxSlideText(xml)).toBe("Tom & Jerry <3\nLine 2");
  });

  it("detects kind from extension plus magic bytes, rejecting mismatches", () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14]);
    expect(detectKind("Tema 3.PDF", pdf)).toBe("pdf");
    expect(detectKind("deck.pptx", zip)).toBe("pptx");
    expect(detectKind("notes.docx", zip)).toBe("docx");
    expect(detectKind("evil.pdf", zip)).toBeNull();
    expect(detectKind("notes.doc", zip)).toBeNull();
    expect(detectKind("photo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
});
