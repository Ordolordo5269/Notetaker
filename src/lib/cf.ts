import { getCloudflareContext } from "@opennextjs/cloudflare";

/** Cloudflare bindings for the current request (Next.js route handlers / RSC). */
export async function getEnv(): Promise<CloudflareEnv> {
  const { env } = await getCloudflareContext({ async: true });
  return env;
}

/**
 * Keep the request alive for background work after the response is sent.
 * Falls back to fire-and-forget outside the Workers runtime.
 */
export async function waitUntil(promise: Promise<unknown>): Promise<void> {
  try {
    const { ctx } = await getCloudflareContext({ async: true });
    ctx.waitUntil(promise);
  } catch {
    void promise;
  }
}
