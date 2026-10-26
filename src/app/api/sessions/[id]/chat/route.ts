import { z } from "zod";
import { authedRoute, readJson } from "@/lib/api/route";
import { getLectureRow } from "@/lib/data/lectures";
import {
  appendMessage,
  createConversation,
  getConversation,
  listConversations,
  listMessages,
  setConversationTitle,
  type AssistantPayload,
} from "@/lib/data/chat";
import { ensureIndex, retrieve } from "@/lib/chat/retrieval";
import { answerQuestion } from "@/lib/chat/answer";
import { assertBudget, recordUsage } from "@/lib/cost/usage";
import { tokenCost } from "@/lib/cost/pricing";
import { safetyIdentifier } from "@/lib/openai/client";
import { subjects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { conflict } from "@/lib/errors";

const Body = z.object({
  conversationId: z.string().uuid().nullish(),
  message: z.string().trim().min(1).max(4000),
  language: z.enum(["auto", "es", "en", "bilingual"]).default("auto"),
});

export const GET = authedRoute<{ id: string }>(async ({ db, user, params }) => {
  await getLectureRow(db, user.id, params.id);
  return { conversations: await listConversations(db, user.id, params.id) };
});

/** Ask a question about this lecture. Answers are grounded in retrieved sources. */
export const POST = authedRoute<{ id: string }>(async ({ db, user, params, req, config }) => {
  const body = await readJson(req, Body);
  const lecture = await getLectureRow(db, user.id, params.id);
  if (lecture.status !== "ready") throw conflict("La clase todavía no ha terminado de grabarse.");
  await assertBudget(db, user.id, tokenCost(config.models.chat, 12_000, 0, 2_500));

  let conversationId = body.conversationId ?? null;
  if (conversationId) await getConversation(db, user.id, conversationId);
  else conversationId = await createConversation(db, user.id, params.id);
  const history = (await listMessages(db, user.id, conversationId)).map((m) => ({ role: m.role, content: m.content }));
  await appendMessage(db, user.id, conversationId, "user", body.message);

  await ensureIndex(db, config, user.id, params.id);
  const sources = await retrieve(db, config, user.id, params.id, body.message, { k: 10 });
  const [subject] = lecture.subjectId
    ? await db.select({ name: subjects.name }).from(subjects).where(eq(subjects.id, lecture.subjectId)).limit(1)
    : [];
  const answer = await answerQuestion(config, {
    question: body.message,
    sources,
    history,
    language: body.language,
    lectureTitle: lecture.title,
    subjectName: subject?.name ?? null,
    safetyId: await safetyIdentifier(user.id),
  });
  await recordUsage(db, {
    userId: user.id,
    sessionId: params.id,
    kind: "llm",
    model: config.models.chat,
    inputTokens: answer.usage.inputTokens,
    cachedInputTokens: answer.usage.cachedInputTokens,
    outputTokens: answer.usage.outputTokens,
  });
  const payload: AssistantPayload = {
    grounded: answer.grounded,
    additional: answer.additional,
    notInLecture: answer.notInLecture,
    followUps: answer.followUps,
    citations: answer.citations,
    sourcesUsed: sources.length,
    language: body.language,
  };
  const content = [answer.grounded, answer.additional].filter(Boolean).join("\n\n");
  const messageId = await appendMessage(db, user.id, conversationId, "assistant", content, payload);
  if (!history.length) await setConversationTitle(db, conversationId, body.message);
  return { conversationId, messageId, answer: payload };
});
