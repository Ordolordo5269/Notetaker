// Creating and dispatching processing jobs.
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { lectureSessions, processingJobs, type JobType } from "@/lib/db/schema";
import { conflict, notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { inlineStepRunner, runJob } from "./runner";

export interface JobView {
  id: string;
  jobType: JobType;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage: string | null;
  error: string | null;
  estimatedCostUsd: number | null;
  costUsd: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  params: Record<string, unknown>;
  result: Record<string, unknown> | null;
}

export async function listJobs(db: Db, userId: string, sessionId: string, limit = 20): Promise<JobView[]> {
  return db
    .select({
      id: processingJobs.id,
      jobType: processingJobs.jobType,
      status: processingJobs.status,
      stage: processingJobs.stage,
      error: processingJobs.error,
      estimatedCostUsd: processingJobs.estimatedCostUsd,
      costUsd: processingJobs.costUsd,
      createdAt: processingJobs.createdAt,
      startedAt: processingJobs.startedAt,
      finishedAt: processingJobs.finishedAt,
      params: processingJobs.params,
      result: processingJobs.result,
    })
    .from(processingJobs)
    .where(and(eq(processingJobs.userId, userId), eq(processingJobs.sessionId, sessionId)))
    .orderBy(desc(processingJobs.createdAt))
    .limit(limit);
}

export async function getJob(db: Db, userId: string, jobId: string): Promise<JobView> {
  const rows = await db
    .select({
      id: processingJobs.id,
      jobType: processingJobs.jobType,
      status: processingJobs.status,
      stage: processingJobs.stage,
      error: processingJobs.error,
      estimatedCostUsd: processingJobs.estimatedCostUsd,
      costUsd: processingJobs.costUsd,
      createdAt: processingJobs.createdAt,
      startedAt: processingJobs.startedAt,
      finishedAt: processingJobs.finishedAt,
      params: processingJobs.params,
      result: processingJobs.result,
    })
    .from(processingJobs)
    .where(and(eq(processingJobs.id, jobId), eq(processingJobs.userId, userId)))
    .limit(1);
  if (!rows[0]) throw notFound("Trabajo");
  return rows[0];
}

/**
 * Create a job and start it. One active job per dedupe key per user: a second
 * request for the same work returns the running job instead of duplicating it.
 */
export async function enqueueJob(
  env: CloudflareEnv,
  db: Db,
  input: {
    userId: string;
    sessionId: string | null;
    jobType: JobType;
    dedupeKey: string;
    params: Record<string, unknown>;
    estimatedCostUsd?: number | null;
  },
): Promise<{ job: JobView; created: boolean }> {
  const [existing] = await db
    .select({ id: processingJobs.id })
    .from(processingJobs)
    .where(
      and(
        eq(processingJobs.userId, input.userId),
        eq(processingJobs.dedupeKey, input.dedupeKey),
        inArray(processingJobs.status, ["queued", "running"]),
      ),
    )
    .limit(1);
  if (existing) return { job: await getJob(db, input.userId, existing.id), created: false };

  if (input.sessionId) {
    const [s] = await db
      .select({ status: lectureSessions.status })
      .from(lectureSessions)
      .where(and(eq(lectureSessions.id, input.sessionId), eq(lectureSessions.userId, input.userId)))
      .limit(1);
    if (!s) throw notFound("Clase");
    if (s.status !== "ready") throw conflict("La clase todavía no ha terminado de grabarse.");
  }

  const id = newId();
  const now = Date.now();
  await db.insert(processingJobs).values({
    id,
    userId: input.userId,
    sessionId: input.sessionId,
    jobType: input.jobType,
    status: "queued",
    stage: "queued",
    dedupeKey: input.dedupeKey,
    params: input.params,
    result: null,
    estimatedCostUsd: input.estimatedCostUsd ?? null,
    costUsd: 0,
    runner: env.JOBS_WORKFLOW ? "workflow" : "local",
    attempt: 1,
    createdAt: now,
    updatedAt: now,
  });
  if (input.sessionId) {
    await db
      .update(lectureSessions)
      .set({ processingStatus: "queued", updatedAt: now })
      .where(and(eq(lectureSessions.id, input.sessionId), eq(lectureSessions.status, "ready")));
  }

  if (env.JOBS_WORKFLOW) {
    try {
      const instance = await env.JOBS_WORKFLOW.create({ id, params: { jobId: id } });
      await db.update(processingJobs).set({ workflowInstanceId: instance.id }).where(eq(processingJobs.id, id));
    } catch (err) {
      const message = `No se pudo iniciar el trabajo: ${(err as Error).message}`;
      await db
        .update(processingJobs)
        .set({ status: "failed", error: message, finishedAt: Date.now(), updatedAt: Date.now() })
        .where(eq(processingJobs.id, id));
      throw conflict(message);
    }
  } else {
    // Development without Workflows: run in-process after the response.
    const { waitUntil } = await import("@/lib/cf");
    await waitUntil(runJob(env, id, inlineStepRunner).catch(() => undefined));
  }
  return { job: await getJob(db, input.userId, id), created: true };
}

export async function cancelJob(db: Db, userId: string, jobId: string) {
  const job = await getJob(db, userId, jobId);
  if (job.status !== "queued" && job.status !== "running") return job;
  const now = Date.now();
  await db
    .update(processingJobs)
    .set({ status: "cancelled", finishedAt: now, updatedAt: now })
    .where(and(eq(processingJobs.id, jobId), eq(processingJobs.userId, userId)));
  return getJob(db, userId, jobId);
}
