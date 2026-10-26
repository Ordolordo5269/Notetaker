import { after } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/** Cloudflare bindings for the current request (Next.js route handlers / RSC). */
export async function getEnv(): Promise<CloudflareEnv> {
  const { env } = await getCloudflareContext({ async: true });
  return env;
}

/**
 * Keep the request alive for background work after the response is sent.
 * `after()` runs the promise inside Next's request scope (so `fetch` keeps
 * working in `next dev`); on Workers it maps to `ctx.waitUntil`.
 */
export async function waitUntil(promise: Promise<unknown>): Promise<void> {
  try {
    after(promise);
    return;
  } catch {
    /* not inside a request: fall through */
  }
  try {
    const { ctx } = await getCloudflareContext({ async: true });
    ctx.waitUntil(promise);
  } catch {
    void promise;
  }
}
