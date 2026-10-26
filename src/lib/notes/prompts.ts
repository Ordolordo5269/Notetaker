// Prompts and strict JSON schemas for the study-material pipelines.
// Every prompt repeats the fidelity rules: no invented law, dates, articles,
// case law or attributions; complementary explanations are labelled; every
// substantive claim cites the transcript via segment markers.
import type { DocumentLanguage } from "@/lib/db/schema";

export const FIDELITY_RULES = `Reglas de fidelidad (obligatorias):
- Trabaja únicamente con lo que aparece en la transcripción (y, si se aportan, en los documentos adjuntos).
- No inventes leyes, artículos, fechas, cifras, jurisprudencia, autores ni citas. Si el profesor cita algo de forma incompleta, reprodúcelo tal cual y señala que es incompleto.
- No atribuyas al profesor nada que no haya dicho. Distingue sus opiniones ("el profesor considera…") de las reglas o definiciones.
- Si añades una aclaración pedagógica que NO procede de la clase, enciérrala en un bloque que empiece por "> **Explicación complementaria:**" y mantenla breve.
- Si un pasaje es ambiguo, confuso o contradictorio, dilo expresamente en lugar de resolverlo con suposiciones.
- No rellenes lagunas: si falta información, indícalo.
- Conserva los términos técnicos, nombres propios, números de artículo y citas en el idioma en que se pronunciaron.
- Cita las fuentes con el marcador de segmento tal como aparece en la transcripción, p. ej. ⟦s12 00:23:10⟧; para un tramo usa [[ref:12-18]] (número inicial y final de segmento). Cada párrafo sustantivo debe llevar al menos una cita al final.`;

export function languageInstruction(language: DocumentLanguage, dominant: "es" | "en"): string {
  switch (language) {
    case "es":
      return "Redacta todo el texto explicativo en español. Mantén en su idioma original las citas literales, los nombres de normas y los términos técnicos pronunciados en inglés (puedes añadir una traducción entre paréntesis la primera vez).";
    case "en":
      return "Write all explanatory text in English. Keep verbatim quotations, names of legal instruments and technical terms in the language in which they were spoken (you may add a translation in brackets the first time).";
    case "bilingual":
      return dominant === "en"
        ? "Write the main text in English and add, after each key definition or rule, a concise Spanish rendering in italics. Keep terminology as spoken."
        : "Redacta el texto principal en español y añade, tras cada definición o regla clave, una versión concisa en inglés en cursiva. Mantén la terminología tal como se pronunció.";
  }
}

export function resolveLanguage(requested: DocumentLanguage | "auto", dominant: "es" | "en"): DocumentLanguage {
  return requested === "auto" ? dominant : requested;
}

// ---------------------------------------------------------------------------
// Step 2 — per-block extraction (fast model)
// ---------------------------------------------------------------------------

export interface ExtractionItem {
  text: string;
  refs: string;
}
export interface BlockExtraction {
  topics: { title: string; summary: string; refs: string }[];
  definitions: { term: string; definition: string; refs: string }[];
  norms: { name: string; content: string; refs: string }[];
  examples: { description: string; illustrates: string; refs: string }[];
  exceptions: ExtractionItem[];
  comparisons: ExtractionItem[];
  teacherComments: ExtractionItem[];
  examWarnings: ExtractionItem[];
  ambiguities: ExtractionItem[];
}

const refsProp = { type: "string", description: "Marcadores de segmento citados, p. ej. '⟦s12⟧ ⟦s13⟧' o '12-15'." };
const itemSchema = {
  type: "object",
  additionalProperties: false,
  required: ["text", "refs"],
  properties: { text: { type: "string" }, refs: refsProp },
};

export const extractionSchema = {
  name: "block_extraction",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "topics",
      "definitions",
      "norms",
      "examples",
      "exceptions",
      "comparisons",
      "teacherComments",
      "examWarnings",
      "ambiguities",
    ],
    properties: {
      topics: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "summary", "refs"],
          properties: { title: { type: "string" }, summary: { type: "string" }, refs: refsProp },
        },
      },
      definitions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["term", "definition", "refs"],
          properties: { term: { type: "string" }, definition: { type: "string" }, refs: refsProp },
        },
      },
      norms: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "content", "refs"],
          properties: { name: { type: "string" }, content: { type: "string" }, refs: refsProp },
        },
      },
      examples: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["description", "illustrates", "refs"],
          properties: { description: { type: "string" }, illustrates: { type: "string" }, refs: refsProp },
        },
      },
      exceptions: { type: "array", items: itemSchema },
      comparisons: { type: "array", items: itemSchema },
      teacherComments: { type: "array", items: itemSchema },
      examWarnings: { type: "array", items: itemSchema },
      ambiguities: { type: "array", items: itemSchema },
    },
  },
};

export const extractionSystem = `Eres un asistente académico que analiza la transcripción de un fragmento de clase universitaria. Extrae, SIN reformular más de lo necesario y SIN añadir nada que no esté en el texto:
- temas tratados (título breve + resumen de 1-3 frases),
- definiciones dadas por el profesor,
- normas, artículos, tratados, teorías o doctrinas mencionados (con lo que se dijo de ellos),
- ejemplos y casos explicados (qué ilustran),
- excepciones y matices,
- comparaciones entre conceptos,
- comentarios u opiniones del profesor,
- avisos relacionados con el examen ("esto cae", "importante", "no confundáis…"),
- pasajes ambiguos o contradictorios.
Cada elemento lleva en "refs" los marcadores ⟦sN⟧ de los segmentos de donde procede. Escribe cada campo en el idioma en que se dijo en clase. Si una categoría no aparece en el fragmento, devuelve una lista vacía.`;

// ---------------------------------------------------------------------------
// Step 3 — global outline (notes model)
// ---------------------------------------------------------------------------

export interface OutlineSection {
  id: string;
  heading: string;
  level: 1 | 2;
  purpose: string;
  /** Segment ranges "a-b" that feed this section. */
  ranges: string[];
  /** Relative depth: 1 (brief) to 5 (very detailed). */
  weight: number;
}
export interface Outline {
  title: string;
  sections: OutlineSection[];
  notes: string;
}

export const outlineSchema = {
  name: "notes_outline",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "sections", "notes"],
    properties: {
      title: { type: "string" },
      notes: { type: "string", description: "Observaciones globales: huecos, repeticiones, orden real de la clase." },
      sections: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "heading", "level", "purpose", "ranges", "weight"],
          properties: {
            id: { type: "string", description: "identificador corto en minúsculas, p. ej. 'intro', 'art24'" },
            heading: { type: "string" },
            level: { type: "integer", enum: [1, 2] },
            purpose: { type: "string", description: "Qué debe cubrir esta sección y qué elementos extraídos incluye." },
            ranges: { type: "array", items: { type: "string" }, description: "Tramos de segmentos 'a-b' relevantes." },
            weight: { type: "integer", minimum: 1, maximum: 5 },
          },
        },
      },
    },
  },
};

export const outlineSystem = `Eres un estudiante brillante que planifica unos apuntes completos a partir del análisis de TODA una clase universitaria. Recibes los elementos extraídos de cada bloque de la transcripción (temas, definiciones, normas, ejemplos, excepciones, comparaciones, comentarios, avisos de examen, ambigüedades), los marcadores que el alumno puso durante la clase y los datos de la asignatura.

Diseña el índice del documento final ANTES de redactarlo, de modo que todas las partes de la clase reciban un detalle proporcional a su peso real (evita que el principio quede muy detallado y el final resumido). Agrupa el material por temas, no por orden cronológico estricto, pero respeta la lógica de la explicación. Estructura orientativa (omite apartados sin material real):
1. Introducción y contexto · 2. Conceptos fundamentales · 3. Desarrollo detallado de cada tema (una sección de nivel 1 por tema, subsecciones de nivel 2 si procede) · 4. Definiciones y términos importantes · 5. Normativa, artículos o teorías mencionadas · 6. Ejemplos explicados por el profesor · 7. Excepciones y diferencias importantes · 8. Relaciones entre conceptos · 9. Errores frecuentes y advertencias · 10. Posibles contenidos de examen · 11. Síntesis final.
Para cada sección indica los tramos de segmentos ("a-b") de los que debe nutrirse y un peso de 1 a 5 según la cantidad de material. Una sección de nivel 1 con subsecciones de nivel 2 funciona solo como introducción breve del bloque: el contenido va en las subsecciones, así que no dupliques el mismo tema en ambos niveles. Usa subsecciones solo cuando un tema tenga partes claramente distintas; de lo contrario, una sección de nivel 1 basta. No inventes temas. Escribe título y encabezados en el idioma de los apuntes indicado.`;

// ---------------------------------------------------------------------------
// Step 5 — section drafting (notes model)
// ---------------------------------------------------------------------------

export interface SectionDraft {
  markdown: string;
  ambiguities: string[];
}

export const sectionSchema = {
  name: "notes_section",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["markdown", "ambiguities"],
    properties: {
      markdown: { type: "string", description: "Contenido de la sección en Markdown, sin el encabezado principal." },
      ambiguities: { type: "array", items: { type: "string" } },
    },
  },
};

export function sectionSystem(language: DocumentLanguage, dominant: "es" | "en"): string {
  return `Eres un estudiante muy competente que redacta UNA sección de unos apuntes universitarios completos y fieles a lo explicado en clase. Dispones de: la especificación de la sección (dentro del índice global), los pasajes relevantes de la transcripción con marcadores ⟦sN hh:mm:ss⟧, los elementos extraídos relacionados y, si existen, páginas de las diapositivas del profesor.

Objetivo: profundidad real, no un resumen genérico. Explica los conceptos como lo hizo el profesor, con sus ejemplos, matices, excepciones y comparaciones; reorganiza y ordena lo que en el audio era repetitivo o desordenado, pero no cambies el significado. La extensión depende del material: una sección con mucho contenido puede ocupar varias páginas.

Formato: Markdown (párrafos, listas, tablas cuando comparen cosas, negrita para términos clave). NO incluyas el encabezado principal de la sección (ya existe); puedes usar encabezados de nivel 3 (###) para subapartados. Termina cada párrafo sustantivo con la cita del tramo correspondiente, p. ej. [[ref:12-18]].
${languageInstruction(language, dominant)}

${FIDELITY_RULES}

Si las diapositivas contienen una definición o estructura que el profesor NO explicó oralmente, puedes incorporarla indicando "(según las diapositivas, p. N)" sin afirmar que el profesor lo dijo. Si diapositivas y explicación discrepan, señálalo.`;
}

// ---------------------------------------------------------------------------
// Step 6 — review (notes model)
// ---------------------------------------------------------------------------

export interface ReviewResult {
  missing: { item: string; sectionId: string }[];
  issues: { sectionId: string; issue: string; severity: "low" | "medium" | "high" }[];
  summary: string;
}

export const reviewSchema = {
  name: "notes_review",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["missing", "issues", "summary"],
    properties: {
      summary: { type: "string" },
      missing: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["item", "sectionId"],
          properties: {
            item: { type: "string", description: "Elemento de la lista de control que no aparece en el borrador." },
            sectionId: { type: "string", description: "Sección donde debería incorporarse." },
          },
        },
      },
      issues: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["sectionId", "issue", "severity"],
          properties: {
            sectionId: { type: "string" },
            issue: { type: "string" },
            severity: { type: "string", enum: ["low", "medium", "high"] },
          },
        },
      },
    },
  },
};

export const reviewSystem = `Eres un revisor académico exigente. Recibes (a) la lista de control con todos los elementos extraídos de la transcripción (temas, definiciones, normas, ejemplos, excepciones, comparaciones, avisos de examen) y (b) el borrador completo de los apuntes. Comprueba:
1. Cobertura: qué elementos de la lista NO aparecen en el borrador (ni siquiera reformulados). Indica en qué sección deberían ir.
2. Problemas: afirmaciones que no se sostienen en la transcripción, contradicciones internas, terminología inconsistente, ejemplos deformados, secciones desproporcionadas, citas [[ref]] ausentes en párrafos sustantivos.
Sé concreto y breve. No propongas añadir información externa.`;

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

export type SummaryMode = "summary_quick" | "summary_full" | "summary_last_minute";

export const SUMMARY_SPECS: Record<SummaryMode, { title: string; instruction: string; maxWords: number }> = {
  summary_quick: {
    title: "Repaso rápido",
    maxWords: 450,
    instruction:
      "Visión general en una página: ideas esenciales de la clase, 5-10 conceptos que memorizar, 3-5 diferencias o excepciones clave y 3 preguntas de autocomprobación. Frases cortas y listas.",
  },
  summary_full: {
    title: "Repaso completo",
    maxWords: 1400,
    instruction:
      "Resumen de extensión intermedia para repasar tras estudiar los apuntes: por cada tema, las ideas esenciales, definiciones exactas, normas/artículos citados, excepciones, un ejemplo breve y las relaciones con otros temas. Incluye un esquema simple (lista jerárquica) y 6-10 preguntas clave con respuesta de una línea.",
  },
  summary_last_minute: {
    title: "Última hora",
    maxWords: 300,
    instruction:
      "Chuleta mental para los minutos previos al examen: solo lo imprescindible, en listas muy compactas: términos y definiciones de una línea, artículos/normas y qué dicen, excepciones que suelen preguntarse y los avisos del profesor sobre el examen.",
  },
};

export const summarySchema = {
  name: "summary_document",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["sections"],
    properties: {
      sections: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["heading", "markdown"],
          properties: { heading: { type: "string" }, markdown: { type: "string" } },
        },
      },
    },
  },
};

export function summarySystem(mode: SummaryMode, language: DocumentLanguage, dominant: "es" | "en"): string {
  const spec = SUMMARY_SPECS[mode];
  return `Eres un estudiante que prepara un material de repaso ("${spec.title}") a partir de los apuntes completos de una clase y su transcripción. ${spec.instruction} Extensión máxima aproximada: ${spec.maxWords} palabras. Devuelve varias secciones cortas con encabezado y contenido en Markdown. Conserva las citas [[ref:a-b]] de los apuntes cuando reutilices una afirmación.
${languageInstruction(language, dominant)}

${FIDELITY_RULES}`;
}

// ---------------------------------------------------------------------------
// Exam questions
// ---------------------------------------------------------------------------

export interface GeneratedQuestion {
  qtype: "mcq" | "short" | "essay" | "oral" | "case";
  level: number | null;
  concept: string;
  prompt: string;
  options: string[];
  correctOption: number;
  answer: string;
  explanation: string;
  rubric: string[];
  refs: string;
  extendsSyllabus: boolean;
}

export const questionsSchema = {
  name: "exam_questions",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["questions"],
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "qtype",
            "level",
            "concept",
            "prompt",
            "options",
            "correctOption",
            "answer",
            "explanation",
            "rubric",
            "refs",
            "extendsSyllabus",
          ],
          properties: {
            qtype: { type: "string", enum: ["mcq", "short", "essay", "oral", "case"] },
            level: { type: ["integer", "null"], description: "Solo para 'oral': 1-4." },
            concept: { type: "string", description: "Concepto evaluado (corto)." },
            prompt: { type: "string" },
            options: { type: "array", items: { type: "string" }, description: "4 alternativas para mcq; vacío si no." },
            correctOption: { type: "integer", description: "Índice 0-3 para mcq; -1 si no aplica." },
            answer: { type: "string", description: "Respuesta modelo o solución razonada." },
            explanation: { type: "string", description: "Por qué es correcta y por qué las demás no (mcq)." },
            rubric: {
              type: "array",
              items: { type: "string" },
              description: "Criterios de corrección (essay/case/oral).",
            },
            refs: { type: "string", description: "Tramos [[ref:a-b]] en los que se basa." },
            extendsSyllabus: {
              type: "boolean",
              description: "true si la solución requiere material que no se explicó en clase.",
            },
          },
        },
      },
    },
  },
};

export const QUESTION_TYPE_LABEL: Record<GeneratedQuestion["qtype"], string> = {
  mcq: "Tipo test",
  short: "Pregunta corta",
  essay: "Desarrollo",
  oral: "Examen oral",
  case: "Caso práctico",
};

export function questionsSystem(language: DocumentLanguage, dominant: "es" | "en"): string {
  return `Eres un profesor particular que prepara preguntas de examen universitario EXCLUSIVAMENTE sobre lo explicado en una clase (apuntes y transcripción aportados).
Tipos:
- mcq: 4 alternativas plausibles, una sola correcta, explicación de la solución y del error de cada distractor, concepto evaluado.
- short: definiciones, diferencias, explicaciones o aplicación de conceptos; respuesta modelo de 3-8 líneas.
- essay: pregunta amplia con esquema de respuesta y criterios de corrección.
- oral: nivel 1 definiciones y reconocimiento; nivel 2 explicación y comprensión; nivel 3 comparación, argumentación y aplicación; nivel 4 casos difíciles, excepciones y análisis crítico.
- case: supuesto de hecho realista (especialmente en Derecho y Relaciones Internacionales), preguntas y solución razonada paso a paso, aplicando solo las normas y criterios explicados en clase. Si la solución exigiría normas no vistas, indícalo y marca extendsSyllabus=true.
Reparte las preguntas entre los temas según su peso en la clase; prioriza lo que el profesor señaló como importante o de examen. No repitas el mismo concepto en varias preguntas del mismo tipo. Cita los tramos de la transcripción en "refs".
${languageInstruction(language, dominant)}

${FIDELITY_RULES}`;
}
