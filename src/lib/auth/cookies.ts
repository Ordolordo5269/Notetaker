import type { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_TTL_MS } from "./sessions";

function isSecure(req: NextRequest): boolean {
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  return proto === "https";
}

export function setSessionCookie(req: NextRequest, res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isSecure(req),
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(req: NextRequest, res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: isSecure(req),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
