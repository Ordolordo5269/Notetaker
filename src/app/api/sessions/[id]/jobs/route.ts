import "@/lib/jobs/register";
import { authedRoute, readJson } from "@/lib/api/route";
import { getLectureRow } from "@/lib/data/lectures";
import { hasUserEdits } from "@/lib/data/documents";
import { assertBudget } from "@/lib/cost/usage";
import { enqueueJob, listJobs } from "@/lib/jobs/queue";
import { dedupeKeyFor, estimateJob, jobRequestSchema, paramsFor, withProfileDefaults } from "@/lib/jobs/requests";
import { conflict } from "@/lib/errors";

export const GET = authedRoute<{ id: string }>(async ({ db, user, params }) => {
  await getLectureRow(db, user.id, params.id);
  return { jobs: await listJobs(db, user.id, params.id) };
});

/** Launch a processing job for this lecture (notes, summaries, exam, flashcards). */
export const POST = authedRoute<{ id: string }>(async ({ db, env, user, params, req, config }) => {
  const body = await withProfileDefaults(db, user.id, await readJson(req, jobRequestSchema));
  const lecture = await getLectureRow(db, user.id, params.id);
  if (lecture.status !== "ready") throw conflict("La clase todavía no ha terminado de grabarse.");
  const confirmOverwrite = (req.nextUrl.searchParams.get("confirmOverwrite") ?? "") === "1";
  if (body.type === "notes" && !confirmOverwrite && (await hasUserEdits(db, user.id, params.id, "notes"))) {
    throw conflict(
      "Los apuntes actuales contienen cambios manuales. Regenerar crea una versión nueva; la editada se conserva en el historial.",
      "user_edits_present",
    );
  }
  const estimate = await estimateJob(db, config, user.id, params.id, body);
  await assertBudget(db, user.id, estimate.usd, { isJob: true });
  const { job, created } = await enqueueJob(env, db, {
    userId: user.id,
    sessionId: params.id,
    jobType: body.type,
    dedupeKey: dedupeKeyFor(params.id, body),
    params: paramsFor(body),
    estimatedCostUsd: estimate.usd,
  });
  return { job, created, estimate };
});
