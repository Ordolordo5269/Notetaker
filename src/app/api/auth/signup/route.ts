import { NextResponse } from "next/server";
import { z } from "zod";
import { publicRoute, readJson, clientIp } from "@/lib/api/route";
import { assertSignupAllowed, createAccount, normalizeEmail } from "@/lib/auth/accounts";
import { createSession, consumeAttempt } from "@/lib/auth/sessions";
import { setSessionCookie } from "@/lib/auth/cookies";
import { AppError } from "@/lib/errors";

const Body = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
  displayName: z.string().max(120).optional(),
});

export const POST = publicRoute(async ({ req, db, config }) => {
  const body = await readJson(req, Body);
  // Throttle account creation per IP (relaxed outside production for local testing).
  const limit = config.appEnv === "production" ? 20 : 1000;
  if (!(await consumeAttempt(db, `signup:${clientIp(req)}`, limit, 60 * 60 * 1000))) {
    throw new AppError(429, "rate_limited", "Demasiados intentos. Espera un poco antes de reintentar.");
  }
  const email = normalizeEmail(body.email);
  await assertSignupAllowed(db, config, email);
  const userId = await createAccount(db, { email, password: body.password, displayName: body.displayName });
  const { token } = await createSession(db, userId, req.headers.get("user-agent"));
  const res = NextResponse.json({ ok: true }, { status: 201 });
  setSessionCookie(req, res, token);
  return res;
});
