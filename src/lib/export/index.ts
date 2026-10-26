// Builders that turn app data (study documents, transcripts) into ExportDoc
// and the browser download helpers. PDF/DOCX rendering happens on the device.
import { describeRefs } from "@/lib/notes/transcript";
import { LANGUAGE_LABEL, type StudyDocumentContent } from "@/lib/notes/types";
import { formatClock, formatDateTime } from "@/lib/time";
import { buildParagraphs, type CleanableSegment } from "@/lib/transcription/clean";
import { markdownToBlocks, type Block, type ExportDoc, type ExportSection } from "./blocks";

export type ExportFormat = "pdf" | "docx" | "md" | "txt";

export interface LectureMeta {
  title: string;
  subject?: string | null;
  date?: string;
  duration?: string;
}

const REF_NOTE = "Las marcas hh:mm–hh:mm remiten al momento de la grabación en el que se explicó cada punto.";

export function studyDocToExport(
  content: StudyDocumentContent,
  lecture: LectureMeta,
  opts: { kindLabel: string; includeToc?: boolean },
): ExportDoc {
  const subtitle = [lecture.subject, lecture.date, lecture.duration].filter(Boolean).join(" · ");
  const sections: ExportSection[] = content.sections.map((s) => ({
    heading: s.heading,
    level: s.level,
    provenance: s.refs.length
      ? `Basado en la explicación entre ${describeRefs(s.refs)}${s.refs.length > 4 ? ` y ${s.refs.length - 4} tramos más` : ""}`
      : undefined,
    blocks: markdownToBlocks(s.markdown, s.refs),
    ambiguities: s.ambiguities,
    edited: s.edited,
  }));
  const notices: ExportDoc["notices"] = [];
  if (content.meta.gaps.length) notices.push({ title: "Tramos sin transcripción", items: content.meta.gaps });
  if (content.meta.uncovered.length) {
    notices.push({
      title: "Puntos de la clase que la revisión no pudo ubicar",
      items: content.meta.uncovered.slice(0, 12),
    });
  }
  return {
    title: content.title,
    subtitle: [opts.kindLabel, subtitle].filter(Boolean).join(" · "),
    metaLines: [
      `${LANGUAGE_LABEL[content.language]} · ${content.meta.wordCount.toLocaleString("es-ES")} palabras · ${content.sections.length} secciones · Generado ${formatDateTime(content.meta.generatedAt)}${content.meta.model ? ` con ${content.meta.model}` : ""}`,
      content.meta.attachments.length ? `Documentos consultados: ${content.meta.attachments.join(", ")}` : "",
      REF_NOTE,
    ].filter(Boolean),
    notices,
    includeToc: opts.includeToc ?? true,
    sections,
    footerNote: `StudyFlow · ${lecture.title}`,
  };
}

export function transcriptToExport(
  lecture: LectureMeta,
  segments: readonly CleanableSegment[],
  opts: { clean: boolean; removeFillers?: boolean },
): ExportDoc {
  const blocks: Block[] = [];
  if (opts.clean) {
    for (const p of buildParagraphs(segments, { removeFillers: opts.removeFillers ?? true })) {
      blocks.push({
        type: "paragraph",
        inlines: p.gap
          ? [{ text: `${formatClock(p.startMs)} · ${p.text}`, italic: true }]
          : [{ text: formatClock(p.startMs), ref: true }, { text: `  ${p.text}` }],
      });
    }
  } else {
    for (const s of segments) {
      if (s.status === "gap" || s.status === "failed") {
        blocks.push({
          type: "paragraph",
          inlines: [
            {
              text: `${formatClock(s.startMs)}–${formatClock(s.endMs)} · ${s.status === "gap" ? "tramo sin grabación" : "tramo no transcrito"}`,
              italic: true,
            },
          ],
        });
      } else if (s.text.trim()) {
        blocks.push({
          type: "paragraph",
          inlines: [{ text: formatClock(s.startMs), ref: true }, { text: `  ${s.text}` }],
        });
      }
    }
  }
  const subtitle = [lecture.subject, lecture.date, lecture.duration].filter(Boolean).join(" · ");
  return {
    title: lecture.title,
    subtitle: [opts.clean ? "Transcripción limpia" : "Transcripción original", subtitle].filter(Boolean).join(" · "),
    metaLines: [
      opts.clean
        ? "Párrafos por pausas y sin muletillas: mismas palabras, mismo idioma, sin traducir."
        : "Fragmentos tal como se reconocieron, en el idioma hablado. Las marcas de tiempo son aproximadas (por fragmento).",
    ],
    notices: [],
    includeToc: false,
    sections: [{ heading: "Transcripción", level: 1, blocks }],
    footerNote: `StudyFlow · ${lecture.title}`,
  };
}

export function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Render on the device and download. Heavy renderers are loaded on demand. */
export async function exportAndDownload(format: "pdf" | "docx", doc: ExportDoc, fileNameBase: string): Promise<void> {
  if (format === "pdf") {
    const { renderPdfBlob } = await import("./pdf");
    downloadBlob(`${fileNameBase}.pdf`, await renderPdfBlob(doc));
  } else {
    const { renderDocxBlob } = await import("./docx");
    downloadBlob(`${fileNameBase}.docx`, await renderDocxBlob(doc));
  }
}
