import { authedRoute } from "@/lib/api/route";
import { getLectureRow } from "@/lib/data/lectures";
import { deleteConversation, getConversation, listMessages } from "@/lib/data/chat";
import { notFound } from "@/lib/errors";

export const GET = authedRoute<{ id: string; conversationId: string }>(async ({ db, user, params }) => {
  await getLectureRow(db, user.id, params.id);
  const conversation = await getConversation(db, user.id, params.conversationId);
  if (conversation.sessionId !== params.id) throw notFound("Conversación");
  return { conversation, messages: await listMessages(db, user.id, params.conversationId) };
});

export const DELETE = authedRoute<{ id: string; conversationId: string }>(async ({ db, user, params }) => {
  await getLectureRow(db, user.id, params.id);
  await deleteConversation(db, user.id, params.conversationId);
});
