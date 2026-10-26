// Markdown → a small block model shared by the PDF and DOCX exporters.
// Parsing uses the same remark stack as the on-screen renderer, so what the
// student sees is what gets exported.
import type { Content, PhrasingContent, Root, RootContent, TableCell } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { TranscriptRef } from "@/lib/notes/types";
import { formatClock } from "@/lib/time";

export interface Inline {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  href?: string;
  /** A transcript time reference (rendered small and muted). */
  ref?: boolean;
}

export type Block =
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "heading"; depth: 1 | 2 | 3 | 4 | 5 | 6; inlines: Inline[] }
  | { type: "list"; ordered: boolean; start: number; items: Block[][] }
  | { type: "quote"; blocks: Block[] }
  | { type: "code"; text: string }
  | { type: "table"; rows: Inline[][][] }
  | { type: "hr" };

const REF_RE = /\[\[ref:(\d+)-(\d+)\]\]/g;

/** Turn `[[ref:a-b]]` tokens into Markdown links to `#ref-a-b`; unknown spans are dropped. */
export function refTokensToLinks(markdown: string, refs: readonly TranscriptRef[]): string {
  const byKey = new Map(refs.map((r) => [`${r.seqFrom}-${r.seqTo}`, r]));
  return markdown
    .replace(REF_RE, (_m, a: string, b: string) => {
      const r = byKey.get(`${a}-${b}`);
      return r ? `[${formatClock(r.startMs)}–${formatClock(r.endMs)}](#ref-${a}-${b})` : "";
    })
    .replace(/[ \t]+([.,;:!?])/g, "$1");
}

const processor = unified().use(remarkParse).use(remarkGfm);

export function parseMarkdown(markdown: string): Root {
  return processor.parse(markdown) as Root;
}

type Marks = Pick<Inline, "bold" | "italic" | "code" | "strike" | "href" | "ref">;

function phrasing(nodes: readonly PhrasingContent[], marks: Marks, out: Inline[]): Inline[] {
  for (const n of nodes) {
    switch (n.type) {
      case "text":
        out.push({ text: n.value, ...marks });
        break;
      case "strong":
        phrasing(n.children, { ...marks, bold: true }, out);
        break;
      case "emphasis":
        phrasing(n.children, { ...marks, italic: true }, out);
        break;
      case "delete":
        phrasing(n.children, { ...marks, strike: true }, out);
        break;
      case "inlineCode":
        out.push({ text: n.value, ...marks, code: true });
        break;
      case "break":
        out.push({ text: "\n", ...marks });
        break;
      case "link": {
        const isRef = n.url.startsWith("#ref-");
        phrasing(n.children, { ...marks, ...(isRef ? { ref: true } : { href: n.url }) }, out);
        break;
      }
      case "image":
        if (n.alt) out.push({ text: n.alt, ...marks, italic: true });
        break;
      case "html":
        break;
      default: {
        const anyNode = n as { children?: PhrasingContent[]; value?: string };
        if (anyNode.children) phrasing(anyNode.children, marks, out);
        else if (typeof anyNode.value === "string") out.push({ text: anyNode.value, ...marks });
      }
    }
  }
  return out;
}

function cellInlines(cell: TableCell): Inline[] {
  return phrasing(cell.children, {}, []);
}

function blocksOf(nodes: readonly (RootContent | Content)[]): Block[] {
  const out: Block[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case "paragraph":
        out.push({ type: "paragraph", inlines: phrasing(n.children, {}, []) });
        break;
      case "heading":
        out.push({ type: "heading", depth: n.depth, inlines: phrasing(n.children, {}, []) });
        break;
      case "list":
        out.push({
          type: "list",
          ordered: Boolean(n.ordered),
          start: n.start ?? 1,
          items: n.children.map((li) => blocksOf(li.children)),
        });
        break;
      case "blockquote":
        out.push({ type: "quote", blocks: blocksOf(n.children) });
        break;
      case "code":
        out.push({ type: "code", text: n.value });
        break;
      case "table":
        out.push({ type: "table", rows: n.children.map((row) => row.children.map(cellInlines)) });
        break;
      case "thematicBreak":
        out.push({ type: "hr" });
        break;
      case "html":
      case "definition":
      case "footnoteDefinition":
      case "yaml":
        break;
      default: {
        const anyNode = n as { children?: PhrasingContent[]; value?: string };
        if (anyNode.children) out.push({ type: "paragraph", inlines: phrasing(anyNode.children, {}, []) });
        else if (typeof anyNode.value === "string") out.push({ type: "paragraph", inlines: [{ text: anyNode.value }] });
      }
    }
  }
  return out;
}

/** Parse a section's Markdown (with `[[ref]]` tokens) into export blocks. */
export function markdownToBlocks(markdown: string, refs: readonly TranscriptRef[] = []): Block[] {
  return blocksOf(parseMarkdown(refTokensToLinks(markdown, refs)).children);
}

export function inlinesText(inlines: readonly Inline[]): string {
  return inlines.map((i) => i.text).join("");
}

// ---------------------------------------------------------------------------
// Export document model
// ---------------------------------------------------------------------------

export interface ExportSection {
  heading: string;
  level: 1 | 2;
  /** "Basado en la explicación entre 00:12:04–00:14:30, …" */
  provenance?: string;
  blocks: Block[];
  ambiguities?: string[];
  edited?: boolean;
}

export interface ExportDoc {
  title: string;
  subtitle?: string;
  metaLines: string[];
  /** Callouts shown before the body (gaps, uncovered items). */
  notices: { title: string; items: string[] }[];
  includeToc: boolean;
  sections: ExportSection[];
  footerNote: string;
}
