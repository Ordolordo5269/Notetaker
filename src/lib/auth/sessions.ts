// Server-side session store in D1. The cookie holds a random token; the
// database only stores its SHA-256, so a database leak does not leak sessions.
import { and, eq, gt, lt } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { authAttempts, authSessions, users } from "@/lib/db/schema";
import { randomToken, sha256Hex } from "./tokens";

export const SESSION_COOKIE = "sf_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 12 * 60 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string;
  displayName: string | null;
}

export async function createSession(db: Db, userId: string, userAgent: string | null) {
  const token = randomToken(32);
  const id = await sha256Hex(token);
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  await db.insert(authSessions).values({
    id,
    userId,
    expiresAt,
    lastUsedAt: now,
    userAgent: userAgent?.slice(0, 300) ?? null,
    createdAt: now,
  });
  return { token, expiresAt };
}

/** Resolve a session token to its user, sliding the expiry when needed. */
export async function validateSession(db: Db, token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const id = await sha256Hex(token);
  const now = Date.now();
  const rows = await db
    .select({
      sessionId: authSessions.id,
      lastUsedAt: authSessions.lastUsedAt,
      id: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(and(eq(authSessions.id, id), gt(authSessions.expiresAt, now)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (now - row.lastUsedAt > TOUCH_INTERVAL_MS) {
    await db
      .update(authSessions)
      .set({ lastUsedAt: now, expiresAt: now + SESSION_TTL_MS })
      .where(eq(authSessions.id, id));
  }
  return { id: row.id, email: row.email, displayName: row.displayName };
}

export async function revokeSession(db: Db, token: string | undefined | null): Promise<void> {
  if (!token) return;
  await db.delete(authSessions).where(eq(authSessions.id, await sha256Hex(token)));
}

export async function revokeAllSessions(db: Db, userId: string): Promise<void> {
  await db.delete(authSessions).where(eq(authSessions.userId, userId));
}

export async function purgeExpiredSessions(db: Db): Promise<void> {
  await db.delete(authSessions).where(lt(authSessions.expiresAt, Date.now()));
}

/**
 * Fixed-window throttle. Returns false when the key exceeded `limit`
 * attempts within `windowMs`.
 */
export async function consumeAttempt(db: Db, key: string, limit: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  const existing = await db.select().from(authAttempts).where(eq(authAttempts.key, key)).limit(1);
  const row = existing[0];
  if (!row || now - row.windowStart > windowMs) {
    await db
      .insert(authAttempts)
      .values({ key, count: 1, windowStart: now })
      .onConflictDoUpdate({ target: authAttempts.key, set: { count: 1, windowStart: now } });
    return true;
  }
  if (row.count >= limit) return false;
  await db
    .update(authAttempts)
    .set({ count: row.count + 1 })
    .where(eq(authAttempts.key, key));
  return true;
}

export async function clearAttempts(db: Db, key: string): Promise<void> {
  await db.delete(authAttempts).where(eq(authAttempts.key, key));
}
