import { NextResponse } from "next/server";
import { publicRoute } from "@/lib/api/route";
import { revokeSession, SESSION_COOKIE } from "@/lib/auth/sessions";
import { clearSessionCookie } from "@/lib/auth/cookies";

export const POST = publicRoute(async ({ req, db }) => {
  await revokeSession(db, req.cookies.get(SESSION_COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(req, res);
  return res;
});
