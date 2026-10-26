import { z } from "zod";
import { authedRoute, readJson } from "@/lib/api/route";
import { getTranscriptionContext } from "@/lib/data/context";
import { assertBudget } from "@/lib/cost/usage";
import { audioCost } from "@/lib/cost/pricing";
import { createRealtimeClientSecret, safetyIdentifier } from "@/lib/openai/client";
import { buildTranscriptionSession } from "@/lib/transcription/session-config";
import { isCaptureOpen } from "@/lib/sessions/state-machine";
import { conflict } from "@/lib/errors";

const Body = z.object({ sessionId: z.string().uuid() });

/**
 * Mints a short-lived OpenAI client secret bound to a transcription session
 * configuration. The browser uses it to open the Realtime WebSocket directly;
 * the project API key never leaves the server.
 */
export const POST = authedRoute(async ({ db, user, req, config }) => {
  const { sessionId } = await readJson(req, Body);
  const ctx = await getTranscriptionContext(db, user.id, sessionId);
  if (!isCaptureOpen(ctx.status)) throw conflict("La grabación de esta clase ya está cerrada.");
  // Block only when the next ~10 minutes of live transcription would exceed the limit.
  await assertBudget(db, user.id, audioCost(config.models.live, 600));
  const session = buildTranscriptionSession(config.models.live, ctx, ctx.delay);
  const secret = await createRealtimeClientSecret(config, session, {
    ttlSeconds: 600,
    safetyId: await safetyIdentifier(user.id),
  });
  const wsBase = config.openaiBaseUrl.replace(/^http/, "ws");
  return {
    clientSecret: secret.value,
    expiresAt: secret.expiresAt,
    model: config.models.live,
    url: `${wsBase}/realtime?intent=transcription`,
    session,
  };
});
