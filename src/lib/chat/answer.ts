// Grounded answers for the lecture chat.
import type { DocumentLanguage } from "@/lib/db/schema";
import type { AppConfig } from "@/lib/env";
import { createStructured, type OpenAIUsage } from "@/lib/openai/client";
import { FIDELITY_RULES } from "@/lib/notes/prompts";
import { formatClock } from "@/lib/time";
import type { RetrievedSource } from "./retrieval";

export interface ChatCitation {
  kind: "transcript" | "attachment" | "notes";
  label: string;
  seqFrom?: number;
  seqTo?: number;
  startMs?: number;
  endMs?: number;
  attachmentId?: string;
  page?: number;
  sectionKey?: string;
}

export interface ChatAnswer {
  /** Markdown answer supported by the lecture (may be empty). */
  grounded: string;
  /** Markdown with general knowledge not attributed to the lecturer (may be empty). */
  additional: string;
  notInLecture: boolean;
  followUps: string[];
  citations: ChatCitation[];
  usage: OpenAIUsage;
}

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

const answerSchema = {
  name: "lecture_chat_answer",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["grounded", "additional", "notInLecture", "followUps"],
    properties: {
      grounded: {
        type: "string",
        description:
          "Respuesta basada en las fuentes de la clase, en Markdown, citando cada afirmación con el identificador de la fuente entre corchetes dobles, p. ej. [[S3]]. Vacía si nada de la clase responde a la pregunta.",
      },
      additional: {
        type: "string",
        description:
          "Explicación pedagógica adicional NO procedente de la clase (conocimiento general), en Markdown. Vacía si no hace falta.",
      },
      notInLecture: { type: "boolean", description: "true si la pregunta no se trató en la clase." },
      followUps: { type: "array", items: { type: "string" }, description: "2-3 preguntas de seguimiento breves." },
    },
  },
};

function sourceLabel(s: RetrievedSource): string {
  if (s.sourceType === "transcript" && s.startMs !== null && s.endMs !== null) {
    return `Clase ${formatClock(s.startMs)}–${formatClock(s.endMs)}`;
  }
  if (s.sourceType === "attachment") {
    const unit = s.attachmentKind === "pptx" ? "diap." : s.attachmentKind === "docx" ? "fragm." : "p.";
    return `${s.fileName ?? "Documento"}, ${unit} ${s.pageNumber ?? "?"}`;
  }
  return `Apuntes: ${s.sectionKey ?? "sección"}`;
}

function languageLine(language: DocumentLanguage | "auto"): string {
  switch (language) {
    case "es":
      return "Responde en español.";
    case "en":
      return "Answer in English.";
    case "bilingual":
      return "Responde en español y, tras cada idea clave, añade una frase equivalente en inglés en cursiva.";
    default:
      return "Responde en el idioma en que está formulada la pregunta (si el usuario pide otro idioma, obedécele). Mantén las citas literales, nombres de normas y términos técnicos en su idioma original.";
  }
}

export async function answerQuestion(
  config: AppConfig,
  input: {
    question: string;
    sources: RetrievedSource[];
    history: HistoryMessage[];
    language: DocumentLanguage | "auto";
    lectureTitle: string;
    subjectName: string | null;
    safetyId?: string;
  },
): Promise<ChatAnswer> {
  const labelled = input.sources.map((s, i) => ({ id: `S${i + 1}`, source: s }));
  const sourcesText = labelled
    .map(({ id, source }) => `[${id}] (${sourceLabel(source)})\n${source.text.slice(0, 2500)}`)
    .join("\n\n");
  const history = input.history
    .slice(-8)
    .map((m) => `${m.role === "user" ? "Alumno" : "Asistente"}: ${m.content.slice(0, 1200)}`)
    .join("\n");
  const system = `Eres el asistente de estudio de una clase universitaria concreta. Respondes a las dudas del alumno usando las FUENTES proporcionadas (fragmentos de la transcripción con su minuto, secciones de los apuntes y páginas de los documentos del profesor).

Formato de la respuesta:
- "grounded": lo que la clase realmente dice sobre la pregunta. Cada afirmación termina con la cita de la fuente, p. ej. [[S2]]. Si el alumno pregunta en qué momento se habló de algo, indica los minutos de las fuentes. Si pide casos prácticos o ejercicios, constrúyelos solo con las reglas explicadas en clase y cita de dónde salen.
- "additional": si conviene, una explicación complementaria de conocimiento general que NO procede de la clase, claramente separada. Nunca la atribuyas al profesor.
- Si la pregunta no se trató en la clase, di explícitamente en "grounded" que no aparece en la clase (una frase), marca notInLecture=true y, si procede, ayuda en "additional".
- Si el alumno pregunta por una diapositiva o página concreta, usa las fuentes de documento de esa página y di qué parte de la explicación oral corresponde; si no hay correspondencia clara, dilo.
${languageLine(input.language)}

${FIDELITY_RULES.replace(/- Cita las fuentes[^\n]*\n?/, "")}`;
  const user = `Asignatura: ${input.subjectName ?? "—"}. Clase: "${input.lectureTitle}".
${history ? `\nCONVERSACIÓN PREVIA:\n${history}\n` : ""}
FUENTES:
${sourcesText || "(no se encontraron fuentes relevantes en la clase)"}

PREGUNTA DEL ALUMNO:
${input.question}`;
  const { data, usage } = await createStructured<{
    grounded: string;
    additional: string;
    notInLecture: boolean;
    followUps: string[];
  }>(config, {
    model: config.models.chat,
    system,
    user,
    schema: answerSchema,
    reasoningEffort: "low",
    maxOutputTokens: 3500,
    safetyId: input.safetyId,
  });

  // Replace [[S3]] with canonical citation tokens the UI can resolve.
  const citations: ChatCitation[] = [];
  const used = new Map<string, number>();
  const resolve = (text: string) =>
    text.replace(/\[\[\s*S(\d+)\s*\]\]/g, (_m, n: string) => {
      const entry = labelled[Number(n) - 1];
      if (!entry) return "";
      let idx = used.get(entry.id);
      if (idx === undefined) {
        idx = citations.length;
        used.set(entry.id, idx);
        const s = entry.source;
        citations.push({
          kind: s.sourceType,
          label: sourceLabel(s),
          seqFrom: s.seqFrom ?? undefined,
          seqTo: s.seqTo ?? undefined,
          startMs: s.startMs ?? undefined,
          endMs: s.endMs ?? undefined,
          attachmentId: s.attachmentId ?? undefined,
          page: s.pageNumber ?? undefined,
          sectionKey: s.sectionKey ?? undefined,
        });
      }
      return `[[cite:${idx}]]`;
    });
  return {
    grounded: resolve(data.grounded ?? "").trim(),
    additional: resolve(data.additional ?? "").trim(),
    notInLecture: Boolean(data.notInLecture),
    followUps: (data.followUps ?? []).slice(0, 3),
    citations,
    usage,
  };
}
