import { count, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { profiles, users } from "@/lib/db/schema";
import type { AppConfig } from "@/lib/env";
import { forbidden, conflict, badRequest } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { hashPassword, validatePasswordPolicy } from "./password";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Sign-up policy. The app spends the owner's OpenAI budget, so sign-up is
 * closed by default: either the e-mail matches ALLOWED_SIGNUP_EMAILS
 * (exact addresses, "*@domain" or "*" for open sign-up), or no account
 * exists yet (the first account becomes the instance owner).
 */
export function emailAllowed(patterns: readonly string[], email: string): boolean {
  const domain = email.slice(email.lastIndexOf("@") + 1);
  return patterns.some((p) => p === "*" || p === email || (p.startsWith("*@") && p.slice(2) === domain));
}

export async function assertSignupAllowed(db: Db, config: AppConfig, email: string): Promise<void> {
  if (config.allowedSignupEmails.length > 0) {
    if (!emailAllowed(config.allowedSignupEmails, email)) {
      throw forbidden("Este correo no está autorizado para crear una cuenta en esta instalación.");
    }
    return;
  }
  const [row] = await db.select({ n: count() }).from(users);
  if ((row?.n ?? 0) > 0) {
    throw forbidden("El registro está cerrado. Añade el correo a ALLOWED_SIGNUP_EMAILS para permitir nuevas cuentas.");
  }
}

export async function createAccount(
  db: Db,
  input: { email: string; password: string; displayName?: string | null },
): Promise<string> {
  const policy = validatePasswordPolicy(input.password);
  if (policy) throw badRequest(policy);
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
  if (existing.length) throw conflict("Ya existe una cuenta con ese correo.", "email_taken");
  const id = newId();
  const now = Date.now();
  const passwordHash = await hashPassword(input.password);
  await db.batch([
    db.insert(users).values({
      id,
      email: input.email,
      passwordHash,
      displayName: input.displayName?.trim() || null,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(profiles).values({
      userId: id,
      notesLanguage: "auto",
      removeFillers: true,
      transcriptionDelay: "medium",
      audioReviewEnabled: false,
      audioRetentionDays: null,
      monthlyBudgetUsd: null,
      jobBudgetUsd: null,
      recordingNoticeAckAt: null,
      createdAt: now,
      updatedAt: now,
    }),
  ]);
  return id;
}
