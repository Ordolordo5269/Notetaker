import { z } from "zod";
import { authedRoute, readJson } from "@/lib/api/route";
import { getLectureRow } from "@/lib/data/lectures";
import { getQuestionFull, recentAttempts, recordAttempt } from "@/lib/data/exam";
import { gradeMcq, gradeOpenAnswer } from "@/lib/study/grading";
import { assertBudget, recordUsage } from "@/lib/cost/usage";
import { tokenCost } from "@/lib/cost/pricing";
import { safetyIdentifier } from "@/lib/openai/client";
import { badRequest, notFound } from "@/lib/errors";

const Body = z.object({
  questionId: z.string().uuid(),
  selectedOption: z.number().int().min(0).max(3).nullish(),
  answer: z.string().max(8000).nullish(),
  language: z.enum(["auto", "es", "en"]).default("auto"),
});

export const GET = authedRoute<{ id: string }>(async ({ db, user, params }) => {
  await getLectureRow(db, user.id, params.id);
  return { attempts: await recentAttempts(db, user.id, params.id) };
});

/** Grade an answer and record the attempt; returns the solution only after answering. */
export const POST = authedRoute<{ id: string }>(async ({ db, user, params, req, config }) => {
  const body = await readJson(req, Body);
  await getLectureRow(db, user.id, params.id);
  const q = await getQuestionFull(db, user.id, body.questionId);
  if (q.sessionId !== params.id) throw notFound("Pregunta");
  let result;
  if (q.qtype === "mcq") {
    if (body.selectedOption === null || body.selectedOption === undefined) throw badRequest("Elige una opción.");
    result = gradeMcq(body.selectedOption, q.correctOption ?? -1);
  } else {
    const answer = (body.answer ?? "").trim();
    await assertBudget(db, user.id, tokenCost(config.models.fast, 2500, 0, 600));
    result = await gradeOpenAnswer(config, {
      qtype: q.qtype,
      prompt: q.prompt,
      modelAnswer: q.answer,
      rubric: q.rubric,
      studentAnswer: answer,
      language: body.language,
      safetyId: await safetyIdentifier(user.id),
    });
    if (result.usage) {
      await recordUsage(db, {
        userId: user.id,
        sessionId: params.id,
        kind: "llm",
        model: config.models.fast,
        inputTokens: result.usage.inputTokens,
        cachedInputTokens: result.usage.cachedInputTokens,
        outputTokens: result.usage.outputTokens,
      });
    }
  }
  const attemptId = await recordAttempt(db, {
    userId: user.id,
    question: { id: q.id, sessionId: q.sessionId, subjectId: q.subjectId },
    answer: body.answer ?? null,
    selectedOption: body.selectedOption ?? null,
    score: result.score,
    verdict: result.verdict,
    feedback: result.feedback || null,
  });
  return {
    attemptId,
    score: result.score,
    verdict: result.verdict,
    feedback: result.feedback,
    solution: {
      answer: q.answer,
      explanation: q.explanation,
      rubric: q.rubric,
      correctOption: q.correctOption,
      sourceRefs: q.sourceRefs,
    },
  };
});
