// Text extraction for lecture attachments (PDF, DOCX, PPTX).
// Returns page-level text so answers can cite "p. 12". Scanned PDFs without
// a text layer are reported as needsOcr rather than pretended to be readable.
import type { AttachmentKind } from "@/lib/db/schema";

export interface ExtractedPage {
  page: number;
  text: string;
}

export interface ExtractionResult {
  pages: ExtractedPage[];
  pageCount: number;
  needsOcr: boolean;
  /** Human label for the page unit ("página", "diapositiva", "fragmento"). */
  unit: "página" | "diapositiva" | "fragmento";
}

const MAX_PAGE_CHARS = 20_000;

function clean(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, MAX_PAGE_CHARS);
}

export async function extractPdf(bytes: ArrayBuffer): Promise<ExtractionResult> {
  const { extractText } = await import("unpdf");
  const result = await extractText(new Uint8Array(bytes), { mergePages: false });
  const pages = result.text.map((t, i) => ({ page: i + 1, text: clean(t) })).filter((p) => p.text.length > 0);
  const totalChars = pages.reduce((n, p) => n + p.text.length, 0);
  return {
    pages,
    pageCount: result.totalPages,
    needsOcr: result.totalPages > 0 && totalChars < 40 * Math.max(1, result.totalPages) * 0.25,
    unit: "página",
  };
}

/** Split long running text into pseudo-pages at paragraph boundaries. */
function paginate(text: string, target = 1800): ExtractedPage[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const pages: ExtractedPage[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current && current.length + p.length > target) {
      pages.push({ page: pages.length + 1, text: clean(current) });
      current = "";
    }
    current += (current ? "\n\n" : "") + p;
  }
  if (current.trim()) pages.push({ page: pages.length + 1, text: clean(current) });
  return pages;
}

export async function extractDocx(bytes: ArrayBuffer): Promise<ExtractionResult> {
  const mammoth = await import("mammoth");
  // mammoth's Node entry reads `buffer`, its browser entry reads `arrayBuffer`; both are a zip over the same bytes.
  const input = { arrayBuffer: bytes, buffer: new Uint8Array(bytes) as unknown as Buffer };
  const { value } = await mammoth.extractRawText(input);
  const pages = paginate(value);
  return { pages, pageCount: pages.length, needsOcr: pages.length === 0, unit: "fragmento" };
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** Slide text from a PPTX: paragraphs (<a:p>) made of runs (<a:t>). */
export function pptxSlideText(xml: string): string {
  const paragraphs: string[] = [];
  for (const p of xml.match(/<a:p\b[\s\S]*?<\/a:p>/g) ?? []) {
    const runs = [...p.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1] ?? ""));
    const line = runs.join("").trim();
    if (line) paragraphs.push(line);
  }
  return paragraphs.join("\n");
}

export async function extractPptx(bytes: ArrayBuffer): Promise<ExtractionResult> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const slides = Object.keys(zip.files)
    .map((name) => ({ name, m: /^ppt\/slides\/slide(\d+)\.xml$/.exec(name) }))
    .filter((x): x is { name: string; m: RegExpExecArray } => x.m !== null)
    .map((x) => ({ name: x.name, n: Number(x.m[1]) }))
    .sort((a, b) => a.n - b.n);
  const pages: ExtractedPage[] = [];
  for (const s of slides) {
    const xml = await zip.file(s.name)!.async("string");
    const text = clean(pptxSlideText(xml));
    if (text) pages.push({ page: s.n, text });
  }
  return { pages, pageCount: slides.length, needsOcr: slides.length > 0 && pages.length === 0, unit: "diapositiva" };
}

export async function extractPages(kind: AttachmentKind, bytes: ArrayBuffer): Promise<ExtractionResult> {
  switch (kind) {
    case "pdf":
      return extractPdf(bytes);
    case "docx":
      return extractDocx(bytes);
    case "pptx":
      return extractPptx(bytes);
  }
}

/** Detect the attachment kind from file name and magic bytes; null when unsupported. */
export function detectKind(fileName: string, head: Uint8Array): AttachmentKind | null {
  const ext = fileName.toLowerCase().split(".").pop();
  const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; // %PDF
  const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04; // PK..
  if (ext === "pdf" && isPdf) return "pdf";
  if (ext === "docx" && isZip) return "docx";
  if (ext === "pptx" && isZip) return "pptx";
  return null;
}

export const UNIT_LABEL: Record<AttachmentKind, "página" | "diapositiva" | "fragmento"> = {
  pdf: "página",
  pptx: "diapositiva",
  docx: "fragmento",
};
