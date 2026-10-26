import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { publicRoute, readJson, clientIp } from "@/lib/api/route";
import { normalizeEmail } from "@/lib/auth/accounts";
import { verifyPassword } from "@/lib/auth/password";
import { clearAttempts, consumeAttempt, createSession } from "@/lib/auth/sessions";
import { setSessionCookie } from "@/lib/auth/cookies";
import { users } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";

const Body = z.object({ email: z.string().max(320), password: z.string().max(200) });

// Hash of a random password: verifying against it keeps the response time
// similar whether or not the e-mail exists.
const DUMMY_HASH = "pbkdf2_sha256$100000$c3R1ZHlmbG93LWR1bW15$0Vf7S2dI0aZ8ZQkC8b8p0m7wX2n9Jq1Yt3uR5sV7xKk=";

export const POST = publicRoute(async ({ req, db }) => {
  const body = await readJson(req, Body);
  const email = normalizeEmail(body.email);
  const keyEmail = `login:${email}`;
  const keyIp = `login-ip:${clientIp(req)}`;
  const okEmail = await consumeAttempt(db, keyEmail, 8, 15 * 60 * 1000);
  // Per-IP ceiling is generous on purpose: a campus NAT puts hundreds of students behind one address.
  const okIp = await consumeAttempt(db, keyIp, 200, 15 * 60 * 1000);
  if (!okEmail || !okIp) {
    throw new AppError(429, "rate_limited", "Demasiados intentos. Espera 15 minutos antes de reintentar.");
  }
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const valid = await verifyPassword(body.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid) {
    throw new AppError(401, "invalid_credentials", "Correo o contraseña incorrectos.");
  }
  await clearAttempts(db, keyEmail);
  const { token } = await createSession(db, user.id, req.headers.get("user-agent"));
  const res = NextResponse.json({ ok: true });
  setSessionCookie(req, res, token);
  return res;
});
