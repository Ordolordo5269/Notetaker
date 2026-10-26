// Generates small attachment fixtures (PDF slides, DOCX notes, PPTX deck) about the
// seeded Brussels I bis lecture so attachment extraction and chat citations can be tested.
// Usage: node scripts/make-fixtures.mjs
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { Document, Packer, Paragraph, HeadingLevel } from "docx";

const require = createRequire(import.meta.url);
const pdfmake = require("pdfmake");

const out = path.resolve("tests/fixtures");
await mkdir(out, { recursive: true });

const SLIDES = [
  {
    title: "Brussels I bis Regulation (EU) 1215/2012",
    bullets: [
      "Jurisdiction, recognition and enforcement in civil and commercial matters",
      "Applies from 10 January 2015 (Art. 81)",
      "Forum vs. applicable law: two different questions",
    ],
  },
  {
    title: "Scope of application (Art. 1)",
    bullets: [
      "Civil and commercial matters, whatever the nature of the court",
      "Excluded: revenue, customs, administrative matters, acta iure imperii",
      "Also excluded: status of natural persons, matrimonial property, insolvency, arbitration",
    ],
  },
  {
    title: "General rule: defendant's domicile (Art. 4)",
    bullets: [
      "Persons domiciled in a Member State are sued in the courts of that State",
      "Nationality is irrelevant: actor sequitur forum rei",
      "Domicile of companies: statutory seat, central administration or principal place of business (Art. 63)",
    ],
  },
  {
    title: "Special jurisdiction (Art. 7)",
    bullets: [
      "Contract: place of performance of the obligation in question (Art. 7(1))",
      "Sale of goods: place of delivery; services: place where services were provided",
      "Tort: place where the harmful event occurred or may occur (Art. 7(2)) — Bier/Mines de potasse: event and damage",
    ],
  },
  {
    title: "Exclusive jurisdiction and lis pendens",
    bullets: [
      "Art. 24: rights in rem in immovable property, company validity, public registers, IP registration, enforcement",
      "Art. 25: choice-of-court agreements (formal requirements)",
      "Art. 29: lis pendens — court first seised; Art. 31(2) exception for the chosen court",
    ],
  },
];

// ---- PDF (slides, one per page) ----
pdfmake.addFonts({
  Geist: {
    normal: path.resolve("public/fonts/Geist-Regular.ttf"),
    bold: path.resolve("public/fonts/Geist-Bold.ttf"),
    italics: path.resolve("public/fonts/Geist-Italic.ttf"),
    bolditalics: path.resolve("public/fonts/Geist-BoldItalic.ttf"),
  },
});
const pdf = pdfmake.createPdf({
  pageSize: "A4",
  pageOrientation: "landscape",
  pageMargins: [60, 60, 60, 60],
  defaultStyle: { font: "Geist", fontSize: 16 },
  content: SLIDES.flatMap((s, i) => [
    { text: s.title, fontSize: 28, bold: true, margin: [0, 40, 0, 24] },
    { ul: [...s.bullets], margin: [0, 0, 0, 0] }, // copy: pdfmake mutates the definition
    { text: `Slide ${i + 1} / ${SLIDES.length}`, fontSize: 10, color: "#888888", margin: [0, 60, 0, 0] },
    ...(i < SLIDES.length - 1 ? [{ text: "", pageBreak: "after" }] : []),
  ]),
});
await pdf.write(path.join(out, "slides-brussels.pdf"));

// ---- DOCX (running notes) ----
const doc = new Document({
  sections: [
    {
      children: SLIDES.flatMap((s) => [
        new Paragraph({ text: s.title, heading: HeadingLevel.HEADING_1 }),
        ...s.bullets.map((b) => new Paragraph({ text: b + ".", spacing: { after: 120 } })),
        new Paragraph({
          text:
            "Nota del profesor: esta sección se amplía en clase con ejemplos de la jurisprudencia del TJUE. " +
            "Recordad que la competencia judicial internacional no determina la ley aplicable.",
          spacing: { after: 240 },
        }),
      ]),
    },
  ],
});
await writeFile(path.join(out, "notes-brussels.docx"), await Packer.toBuffer(doc));

// ---- PPTX (minimal OOXML package; our extractor reads ppt/slides/slideN.xml) ----
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const slideXml = (s) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/>
<p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-GB" b="1"/><a:t>${esc(s.title)}</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/>
<p:txBody><a:bodyPr/>${s.bullets.map((b) => `<a:p><a:r><a:rPr lang="en-GB"/><a:t>${esc(b)}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>`;
const zip = new JSZip();
zip.file(
  "[Content_Types].xml",
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
${SLIDES.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("\n")}
</Types>`,
);
zip.file(
  "_rels/.rels",
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`,
);
zip.file(
  "ppt/presentation.xml",
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:sldIdLst>${SLIDES.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join("")}</p:sldIdLst>
<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`,
);
zip.file(
  "ppt/_rels/presentation.xml.rels",
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${SLIDES.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join("\n")}
</Relationships>`,
);
SLIDES.forEach((s, i) => zip.file(`ppt/slides/slide${i + 1}.xml`, slideXml(s)));
await writeFile(
  path.join(out, "slides-brussels.pptx"),
  await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
);

// ---- Scanned-like PDF (no text layer) ----
const blank = pdfmake.createPdf({
  defaultStyle: { font: "Geist" },
  content: [{ canvas: [{ type: "rect", x: 0, y: 0, w: 400, h: 300, color: "#dddddd" }] }],
});
await blank.write(path.join(out, "scanned-blank.pdf"));

console.log("fixtures written to", out);
