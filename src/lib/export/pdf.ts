// PDF export built in the browser with pdfmake (no server round-trip, the
// document never leaves the device). The definition builder is pure so it can
// be unit-tested with pdfmake's Node entry.
import type { Content, TDocumentDefinitions, TableCell } from "pdfmake/interfaces";
import type { Block, ExportDoc, Inline } from "./blocks";

const COLORS = {
  text: "#1b1d1f",
  muted: "#6b7280",
  subtle: "#9ca3af",
  accent: "#1f5f4a",
  rule: "#e5e7eb",
  codeBg: "#f3f4f6",
  quoteBar: "#cbd5e1",
};

function inlineRuns(inlines: readonly Inline[]): Content[] {
  return inlines.map((i) => {
    const run: Record<string, unknown> = { text: i.text };
    if (i.bold) run.bold = true;
    if (i.italic) run.italics = true;
    if (i.strike) run.decoration = "lineThrough";
    if (i.code) {
      run.background = COLORS.codeBg;
      run.fontSize = 9.5;
    }
    if (i.href) {
      run.link = i.href;
      run.color = COLORS.accent;
      run.decoration = "underline";
    }
    if (i.ref) {
      run.fontSize = 7.5;
      run.color = COLORS.subtle;
      run.text = ` ${i.text}`;
    }
    return run as unknown as Content;
  });
}

function blockContent(b: Block, depth = 0): Content {
  switch (b.type) {
    case "paragraph":
      return { text: inlineRuns(b.inlines), margin: [0, 0, 0, 6] };
    case "heading": {
      const size = b.depth <= 2 ? 13 : b.depth === 3 ? 11.5 : 10.5;
      return { text: inlineRuns(b.inlines), bold: true, fontSize: size, margin: [0, 10, 0, 4] };
    }
    case "list": {
      const items = b.items.map((blocks) => ({ stack: blocks.map((x) => blockContent(x, depth + 1)) }));
      return b.ordered
        ? { ol: items, start: b.start, margin: [0, 0, 0, 6] }
        : { ul: items, margin: [0, 0, 0, 6], markerColor: COLORS.muted };
    }
    case "quote":
      return {
        table: {
          widths: ["*"],
          body: [[{ stack: b.blocks.map((x) => blockContent(x, depth + 1)), italics: true, color: COLORS.muted }]],
        },
        layout: {
          hLineWidth: () => 0,
          vLineWidth: (i: number) => (i === 0 ? 2 : 0),
          vLineColor: () => COLORS.quoteBar,
          paddingLeft: () => 10,
          paddingTop: () => 4,
          paddingBottom: () => 0,
        },
        margin: [0, 2, 0, 8],
      };
    case "code":
      return {
        table: { widths: ["*"], body: [[{ text: b.text, fontSize: 9, preserveLeadingSpaces: true }]] },
        layout: {
          hLineWidth: () => 0,
          vLineWidth: () => 0,
          fillColor: () => COLORS.codeBg,
          paddingLeft: () => 8,
          paddingRight: () => 8,
          paddingTop: () => 6,
          paddingBottom: () => 6,
        },
        margin: [0, 2, 0, 8],
      };
    case "table": {
      const cols = Math.max(1, ...b.rows.map((r) => r.length));
      const body: TableCell[][] = b.rows.map((row, ri) =>
        Array.from({ length: cols }, (_, ci) => {
          const cell = row[ci] ?? [];
          return { text: inlineRuns(cell), bold: ri === 0, fontSize: 9.5 } as TableCell;
        }),
      );
      return {
        table: { headerRows: 1, widths: Array.from({ length: cols }, () => "*"), body },
        layout: {
          hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
            i === 0 || i === node.table.body.length ? 0.8 : 0.4,
          vLineWidth: () => 0,
          hLineColor: (i: number) => (i <= 1 ? COLORS.muted : COLORS.rule),
          paddingTop: () => 4,
          paddingBottom: () => 4,
        },
        margin: [0, 2, 0, 10],
      };
    }
    case "hr":
      return {
        canvas: [{ type: "line", x1: 0, y1: 0, x2: 483, y2: 0, lineWidth: 0.6, lineColor: COLORS.rule }],
        margin: [0, 6, 0, 10],
      };
  }
}

export function buildPdfDefinition(doc: ExportDoc, opts: { font: string }): TDocumentDefinitions {
  const content: Content[] = [];
  content.push({ text: doc.title, fontSize: 22, bold: true, margin: [0, 0, 0, 4], lineHeight: 1.15 });
  if (doc.subtitle) content.push({ text: doc.subtitle, fontSize: 11, color: COLORS.muted, margin: [0, 0, 0, 2] });
  for (const line of doc.metaLines) content.push({ text: line, fontSize: 9, color: COLORS.subtle });
  content.push({
    canvas: [{ type: "line", x1: 0, y1: 8, x2: 483, y2: 8, lineWidth: 0.8, lineColor: COLORS.rule }],
    margin: [0, 0, 0, 14],
  });
  for (const n of doc.notices) {
    content.push({
      table: {
        widths: ["*"],
        body: [
          [
            {
              stack: [
                { text: n.title, bold: true, fontSize: 9.5, margin: [0, 0, 0, 2] },
                { ul: n.items.map((i) => ({ text: i, fontSize: 9 })) },
              ],
              color: COLORS.muted,
            },
          ],
        ],
      },
      layout: {
        hLineWidth: () => 0,
        vLineWidth: () => 0,
        fillColor: () => COLORS.codeBg,
        paddingLeft: () => 10,
        paddingRight: () => 10,
        paddingTop: () => 8,
        paddingBottom: () => 8,
      },
      margin: [0, 0, 0, 12],
    });
  }
  if (doc.includeToc && doc.sections.length > 1) {
    content.push({
      toc: {
        title: { text: "Índice", fontSize: 14, bold: true, margin: [0, 4, 0, 8] },
        textStyle: { fontSize: 10, color: COLORS.text },
        numberStyle: { fontSize: 10, color: COLORS.muted },
      },
      pageBreak: "after",
    } as Content);
  }
  doc.sections.forEach((s, idx) => {
    const isTop = s.level === 1;
    content.push({
      text: s.heading,
      fontSize: isTop ? 16 : 13,
      bold: true,
      margin: [0, idx === 0 ? 0 : isTop ? 18 : 12, 0, 4],
      tocItem: doc.includeToc,
      tocMargin: [isTop ? 0 : 14, isTop ? 4 : 1, 0, 1],
      lineHeight: 1.15,
    } as Content);
    const caption = [s.provenance, s.edited ? "Editado manualmente" : null].filter(Boolean).join(" · ");
    if (caption) content.push({ text: caption, fontSize: 8, color: COLORS.subtle, margin: [0, 0, 0, 8] });
    for (const b of s.blocks) content.push(blockContent(b));
    if (s.ambiguities?.length) {
      content.push({
        text: [{ text: "Pasajes ambiguos en la grabación: ", bold: true }, s.ambiguities.join(" · ")],
        fontSize: 8.5,
        color: COLORS.muted,
        margin: [0, 2, 0, 8],
      });
    }
  });
  return {
    info: { title: doc.title, creator: "StudyFlow", producer: "StudyFlow" },
    pageSize: "A4",
    pageMargins: [56, 60, 56, 64],
    defaultStyle: { font: opts.font, fontSize: 10.5, lineHeight: 1.35, color: COLORS.text },
    footer: (page: number, pages: number) => ({
      columns: [
        { text: doc.footerNote, fontSize: 8, color: COLORS.subtle, margin: [56, 0, 0, 0] },
        { text: `${page} / ${pages}`, alignment: "right", fontSize: 8, color: COLORS.subtle, margin: [0, 0, 56, 0] },
      ],
      margin: [0, 24, 0, 0],
    }),
    content,
  };
}

/** Browser-only: register the bundled Geist fonts (served from /fonts) and render a Blob. */
export async function renderPdfBlob(doc: ExportDoc): Promise<Blob> {
  const mod = (await import("pdfmake/build/pdfmake")) as unknown as {
    default?: typeof import("pdfmake");
  } & typeof import("pdfmake");
  const pdfmake = mod.default ?? mod;
  const origin = window.location.origin;
  pdfmake.addFonts({
    Geist: {
      normal: `${origin}/fonts/Geist-Regular.ttf`,
      bold: `${origin}/fonts/Geist-Bold.ttf`,
      italics: `${origin}/fonts/Geist-Italic.ttf`,
      bolditalics: `${origin}/fonts/Geist-BoldItalic.ttf`,
    },
  });
  const created = pdfmake.createPdf(buildPdfDefinition(doc, { font: "Geist" }));
  return created.getBlob();
}
