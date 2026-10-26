import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { chatConversations, chatMessages } from "@/lib/db/schema";
import { notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import type { ChatAnswer } from "@/lib/chat/answer";

export type AssistantPayload = Omit<ChatAnswer, "usage"> & { sourcesUsed: number; language: string };

export async function listConversations(db: Db, userId: string, sessionId: string) {
  return db
    .select({
      id: chatConversations.id,
      title: chatConversations.title,
      createdAt: chatConversations.createdAt,
      updatedAt: chatConversations.updatedAt,
    })
    .from(chatConversations)
    .where(and(eq(chatConversations.sessionId, sessionId), eq(chatConversations.userId, userId)))
    .orderBy(desc(chatConversations.updatedAt));
}

export async function createConversation(db: Db, userId: string, sessionId: string, title = "") {
  const id = newId();
  const now = Date.now();
  await db.insert(chatConversations).values({ id, userId, sessionId, title, createdAt: now, updatedAt: now });
  return id;
}

export async function getConversation(db: Db, userId: string, conversationId: string) {
  const [row] = await db
    .select()
    .from(chatConversations)
    .where(and(eq(chatConversations.id, conversationId), eq(chatConversations.userId, userId)))
    .limit(1);
  if (!row) throw notFound("Conversación");
  return row;
}

export async function listMessages(db: Db, userId: string, conversationId: string) {
  await getConversation(db, userId, conversationId);
  return db
    .select({
      id: chatMessages.id,
      role: chatMessages.role,
      content: chatMessages.content,
      payload: chatMessages.payload,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(asc(chatMessages.createdAt));
}

export async function appendMessage(
  db: Db,
  userId: string,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  payload: AssistantPayload | null = null,
) {
  const id = newId();
  const now = Date.now();
  await db.batch([
    db.insert(chatMessages).values({ id, userId, conversationId, role, content, payload, createdAt: now }),
    db.update(chatConversations).set({ updatedAt: now }).where(eq(chatConversations.id, conversationId)),
  ]);
  return id;
}

export async function setConversationTitle(db: Db, conversationId: string, title: string) {
  await db
    .update(chatConversations)
    .set({ title: title.slice(0, 120) })
    .where(and(eq(chatConversations.id, conversationId), eq(chatConversations.title, "")));
}

export async function deleteConversation(db: Db, userId: string, conversationId: string) {
  await getConversation(db, userId, conversationId);
  await db.delete(chatConversations).where(eq(chatConversations.id, conversationId));
}
