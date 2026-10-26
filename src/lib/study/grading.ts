// Grading of open answers (short, essay, oral, case) with the fast model.
// MCQ answers are graded locally without any model call.
import type { AppConfig } from "@/lib/env";
import { createStructured, type OpenAIUsage } from "@/lib/openai/client";

export interface GradeResult {
  score: number;
  verdict: "correct" | "partial" | "incorrect";
  feedback: string;
  usage: OpenAIUsage | null;
}

const gradeSchema = {
  name: "answer_grade",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["score", "verdict", "feedback"],
    properties: {
      score: { type: "number", description: "0 a 1" },
      verdict: { type: "string", enum: ["correct", "partial", "incorrect"] },
      feedback: {
        type: "string",
        description:
          "Corrección breve en Markdown: qué está bien, qué falta o es incorrecto y qué debería incluir la respuesta ideal.",
      },
    },
  },
};

export function gradeMcq(selected: number, correct: number): GradeResult {
  const ok = selected === correct;
  return {
    score: ok ? 1 : 0,
    verdict: ok ? "correct" : "incorrect",
    feedback: "",
    usage: null,
  };
}

export async function gradeOpenAnswer(
  config: AppConfig,
  input: {
    qtype: string;
    prompt: string;
    modelAnswer: string;
    rubric: string[] | null;
    studentAnswer: string;
    language: "es" | "en" | "auto";
    safetyId?: string;
  },
): Promise<GradeResult> {
  const { data, usage } = await createStructured<{ score: number; verdict: GradeResult["verdict"]; feedback: string }>(
    config,
    {
      model: config.models.fast,
      system: `Eres un profesor universitario que corrige la respuesta de un estudiante a una pregunta de tipo "${input.qtype}". Compara la respuesta con la respuesta modelo y los criterios de corrección. Puntúa de 0 a 1 (1 = completa y correcta; 0,5 = parcial; 0 = incorrecta o vacía). Sé justo con formulaciones distintas pero equivalentes, y estricto con errores conceptuales. En "feedback" explica en 3-6 líneas qué está bien, qué falta y qué la respuesta ideal debía incluir; no inventes contenido que no esté en la respuesta modelo. ${
        input.language === "en"
          ? "Write the feedback in English."
          : input.language === "es"
            ? "Escribe la corrección en español."
            : "Escribe la corrección en el idioma de la respuesta del estudiante."
      }`,
      user: `PREGUNTA:\n${input.prompt}\n\nRESPUESTA MODELO:\n${input.modelAnswer}\n\nCRITERIOS:\n${(input.rubric ?? []).map((r) => `- ${r}`).join("\n") || "(ninguno)"}\n\nRESPUESTA DEL ESTUDIANTE:\n${input.studentAnswer || "(sin respuesta)"}`,
      schema: gradeSchema,
      reasoningEffort: "low",
      maxOutputTokens: 900,
      safetyId: input.safetyId,
    },
  );
  const score = Math.min(1, Math.max(0, Number(data.score) || 0));
  return {
    score,
    verdict: data.verdict ?? (score >= 0.85 ? "correct" : score >= 0.4 ? "partial" : "incorrect"),
    feedback: data.feedback ?? "",
    usage,
  };
}
