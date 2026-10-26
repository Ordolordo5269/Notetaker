// DOCX export built in the browser with the `docx` library. Word, Pages and
// LibreOffice open the result; the table of contents is a real Word field
// (Word asks to update fields on first open so page numbers fill in).
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type IRunOptions,
} from "docx";
import type { Block, ExportDoc, Inline } from "./blocks";

const GRAY = "6B7280";
const LIGHT = "9CA3AF";
const RULE = "E5E7EB";
const CODE_BG = "F3F4F6";

type Child = Paragraph | Table | TableOfContents;

function runs(inlines: readonly Inline[], base: IRunOptions = {}): (TextRun | ExternalHyperlink)[] {
  const out: (TextRun | ExternalHyperlink)[] = [];
  for (const i of inlines) {
    if (i.text === "\n") {
      out.push(new TextRun({ break: 1 }));
      continue;
    }
    const opts: IRunOptions = {
      ...base,
      text: i.ref ? ` ${i.text}` : i.text,
      bold: i.bold || base.bold,
      italics: i.italic || base.italics,
      strike: i.strike,
      ...(i.code ? { font: "Consolas", shading: { type: ShadingType.CLEAR, fill: CODE_BG } } : {}),
      ...(i.ref ? { size: 15, color: LIGHT } : {}),
    };
    if (i.href) {
      out.push(new ExternalHyperlink({ children: [new TextRun({ ...opts, style: "Hyperlink" })], link: i.href }));
    } else {
      out.push(new TextRun(opts));
    }
  }
  return out;
}

class Builder {
  private listInstance = 0;

  blocks(blocks: readonly Block[], ctx: { level: number; quote?: boolean } = { level: 0 }): Child[] {
    const out: Child[] = [];
    for (const b of blocks) out.push(...this.block(b, ctx));
    return out;
  }

  private para(children: (TextRun | ExternalHyperlink)[], extra: IParagraphOptions = {}, quote?: boolean): Paragraph {
    return new Paragraph({
      children,
      spacing: { after: 120, line: 300 },
      ...(quote
        ? {
            indent: { left: 567 },
            border: { left: { style: BorderStyle.SINGLE, size: 18, color: "CBD5E1", space: 8 } },
          }
        : {}),
      ...extra,
    });
  }

  private block(b: Block, ctx: { level: number; quote?: boolean }): Child[] {
    const base: IRunOptions = ctx.quote ? { italics: true, color: GRAY } : {};
    switch (b.type) {
      case "paragraph":
        return [this.para(runs(b.inlines, base), {}, ctx.quote)];
      case "heading":
        return [
          new Paragraph({
            children: runs(b.inlines, base),
            heading: b.depth <= 3 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4,
            spacing: { before: 200, after: 80 },
          }),
        ];
      case "list": {
        const instance = ++this.listInstance;
        const reference = b.ordered ? "numbers" : "bullets";
        const out: Child[] = [];
        for (const item of b.items) {
          const [first, ...rest] = item;
          if (first && first.type === "paragraph") {
            out.push(
              this.para(runs(first.inlines, base), {
                numbering: { reference, level: Math.min(ctx.level, 2), instance },
                spacing: { after: 60, line: 300 },
              }),
            );
          } else if (first) {
            out.push(...this.block(first, { ...ctx, level: ctx.level + 1 }));
          }
          for (const extra of rest) out.push(...this.block(extra, { ...ctx, level: ctx.level + 1 }));
        }
        return out;
      }
      case "quote":
        return this.blocks(b.blocks, { ...ctx, quote: true });
      case "code":
        return b.text.split("\n").map(
          (line, i, arr) =>
            new Paragraph({
              children: [new TextRun({ text: line || " ", font: "Consolas", size: 18 })],
              shading: { type: ShadingType.CLEAR, fill: CODE_BG },
              spacing: { before: i === 0 ? 80 : 0, after: i === arr.length - 1 ? 160 : 0, line: 260 },
              indent: { left: 200, right: 200 },
            }),
        );
      case "table": {
        const cols = Math.max(1, ...b.rows.map((r) => r.length));
        return [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: b.rows.map(
              (row, ri) =>
                new TableRow({
                  tableHeader: ri === 0,
                  children: Array.from(
                    { length: cols },
                    (_, ci) =>
                      new TableCell({
                        children: [
                          new Paragraph({
                            children: runs(row[ci] ?? [], { bold: ri === 0 }),
                            spacing: { after: 40, line: 276 },
                          }),
                        ],
                        shading: ri === 0 ? { type: ShadingType.CLEAR, fill: CODE_BG } : undefined,
                        margins: { top: 80, bottom: 80, left: 120, right: 120 },
                      }),
                  ),
                }),
            ),
          }),
          new Paragraph({ spacing: { after: 120 } }),
        ];
      }
      case "hr":
        return [
          new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 1 } },
            spacing: { before: 120, after: 200 },
          }),
        ];
    }
  }
}

export function buildDocx(doc: ExportDoc): Document {
  const b = new Builder();
  const children: Child[] = [];
  children.push(new Paragraph({ text: doc.title, heading: HeadingLevel.TITLE, spacing: { after: 80 } }));
  if (doc.subtitle) {
    children.push(
      new Paragraph({ children: [new TextRun({ text: doc.subtitle, color: GRAY, size: 22 })], spacing: { after: 40 } }),
    );
  }
  for (const line of doc.metaLines) {
    children.push(
      new Paragraph({ children: [new TextRun({ text: line, color: LIGHT, size: 17 })], spacing: { after: 20 } }),
    );
  }
  children.push(
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 1 } },
      spacing: { before: 80, after: 240 },
    }),
  );
  for (const n of doc.notices) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: n.title, bold: true, color: GRAY, size: 19 })],
        shading: { type: ShadingType.CLEAR, fill: CODE_BG },
        spacing: { before: 80, after: 40 },
        indent: { left: 200, right: 200 },
      }),
      ...n.items.map(
        (item, i, arr) =>
          new Paragraph({
            children: [new TextRun({ text: `• ${item}`, color: GRAY, size: 18 })],
            shading: { type: ShadingType.CLEAR, fill: CODE_BG },
            spacing: { after: i === arr.length - 1 ? 200 : 20 },
            indent: { left: 300, right: 200 },
          }),
      ),
    );
  }
  if (doc.includeToc && doc.sections.length > 1) {
    children.push(
      new Paragraph({ text: "Índice", heading: HeadingLevel.HEADING_1, spacing: { after: 120 } }),
      new TableOfContents("Índice", { hyperlink: true, headingStyleRange: "1-2" }),
      new Paragraph({ pageBreakBefore: true }),
    );
  }
  for (const s of doc.sections) {
    children.push(
      new Paragraph({
        text: s.heading,
        heading: s.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
        spacing: { before: s.level === 1 ? 360 : 240, after: 80 },
      }),
    );
    const caption = [s.provenance, s.edited ? "Editado manualmente" : null].filter(Boolean).join(" · ");
    if (caption) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: caption, color: LIGHT, size: 16, italics: true })],
          spacing: { after: 160 },
        }),
      );
    }
    children.push(...b.blocks(s.blocks));
    if (s.ambiguities?.length) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: "Pasajes ambiguos en la grabación: ", bold: true, color: GRAY, size: 17 }),
            new TextRun({ text: s.ambiguities.join(" · "), color: GRAY, size: 17 }),
          ],
          spacing: { before: 80, after: 200 },
        }),
      );
    }
  }

  const listLevels = (format: (typeof LevelFormat)[keyof typeof LevelFormat], texts: string[]) =>
    texts.map((text, level) => ({
      level,
      format,
      text,
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
    }));

  return new Document({
    creator: "StudyFlow",
    title: doc.title,
    description: doc.subtitle,
    features: { updateFields: doc.includeToc && doc.sections.length > 1 },
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 22, color: "1B1D1F" } },
        title: { run: { size: 44, bold: true, font: "Calibri", color: "1B1D1F" } },
        heading1: { run: { size: 32, bold: true, font: "Calibri", color: "1B1D1F" } },
        heading2: { run: { size: 27, bold: true, font: "Calibri", color: "1B1D1F" } },
        heading3: { run: { size: 24, bold: true, font: "Calibri", color: "1B1D1F" } },
        heading4: { run: { size: 22, bold: true, font: "Calibri", color: "374151" } },
      },
    },
    numbering: {
      config: [
        { reference: "bullets", levels: listLevels(LevelFormat.BULLET, ["•", "◦", "▪"]) },
        { reference: "numbers", levels: listLevels(LevelFormat.DECIMAL, ["%1.", "%2.", "%3."]) },
      ],
    },
    sections: [
      {
        properties: { page: { margin: { top: 1360, right: 1300, bottom: 1300, left: 1300 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: `${doc.footerNote}    `, size: 16, color: LIGHT }),
                  new TextRun({
                    children: [PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES],
                    size: 16,
                    color: LIGHT,
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
}

export function renderDocxBlob(doc: ExportDoc): Promise<Blob> {
  return Packer.toBlob(buildDocx(doc));
}

/** Node only (tests, scripts). */
export function renderDocxBuffer(doc: ExportDoc): Promise<Buffer> {
  return Packer.toBuffer(buildDocx(doc));
}
