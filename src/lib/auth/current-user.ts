import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getEnv } from "@/lib/cf";
import { getDb } from "@/lib/db";
import { SESSION_COOKIE, validateSession, type SessionUser } from "./sessions";

/** Current user for Server Components (deduplicated per request). */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const env = await getEnv();
  return validateSession(getDb(env.DB), token);
});

/** Like getCurrentUser but redirects to /login when signed out. */
export async function requirePageUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
