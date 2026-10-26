// Job execution core, shared by the Cloudflare Workflow (production) and the
// in-process runner used with `next dev`.
//
// A job is a row in processing_jobs. Handlers split their work into named
// steps; each step's output is persisted in job_steps, so a retried or
// restarted job resumes after the last completed step instead of paying for
// the whole pipeline again.
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db";
import { jobSteps, lectureSessions, processingJobs, type JobType } from "@/lib/db/schema";
import { readConfig, type AppConfig } from "@/lib/env";
import { AppError, BudgetExceededError } from "@/lib/errors";
import { recordUsage, type UsageInput } from "@/lib/cost/usage";
import { OpenAIError } from "@/lib/openai/client";
import { getJobHandler } from "./handlers";

export interface JobParams {
  jobId: string;
}

export interface StepRunner {
  runStep<T>(name: string, fn: () => Promise<T>): Promise<T>;
  nonRetryable(message: string): Error;
}

export interface JobRow {
  id: string;
  userId: string;
  sessionId: string | null;
  jobType: JobType;
  params: Record<string, unknown>;
  attempt: number;
}

export interface JobContext {
  env: CloudflareEnv;
  db: Db;
  config: AppConfig;
  job: JobRow;
  /** Run a resumable step. The result must be JSON-serialisable and < 1 MiB. */
  step<T>(name: string, fn: () => Promise<T>): Promise<T>;
  /** Report the real pipeline stage shown to the user. */
  setStage(stage: string): Promise<void>;
  usage(u: Omit<UsageInput, "userId" | "jobId" | "sessionId">): Promise<number>;
  /** Abort without retries (bad input, budget exceeded, refusal). */
  fail(message: string): never;
}

export type JobHandler = (ctx: JobContext) => Promise<Record<string, unknown> | void>;

const HEARTBEAT_EVERY_MS = 20_000;

export async function runJob(env: CloudflareEnv, jobId: string, steps: StepRunner): Promise<Record<string, unknown>> {
  const db = getDb(env.DB);
  const config = readConfig(env);
  const [row] = await db.select().from(processingJobs).where(eq(processingJobs.id, jobId)).limit(1);
  if (!row) throw steps.nonRetryable(`Job ${jobId} not found`);
  if (row.status === "completed") return row.result ?? {};
  if (row.status === "cancelled") return { cancelled: true };

  const now = Date.now();
  await db
    .update(processingJobs)
    .set({ status: "running", runner: "workflow", startedAt: row.startedAt ?? now, heartbeatAt: now, updatedAt: now })
    .where(eq(processingJobs.id, jobId));
  if (row.sessionId) await setSessionProcessing(db, row.sessionId, "processing");

  let lastBeat = Date.now();
  const beat = async () => {
    if (Date.now() - lastBeat < HEARTBEAT_EVERY_MS) return;
    lastBeat = Date.now();
    await db
      .update(processingJobs)
      .set({ heartbeatAt: lastBeat, updatedAt: lastBeat })
      .where(eq(processingJobs.id, jobId));
  };

  const job: JobRow = {
    id: row.id,
    userId: row.userId,
    sessionId: row.sessionId,
    jobType: row.jobType,
    params: row.params,
    attempt: row.attempt,
  };

  const ctx: JobContext = {
    env,
    db,
    config,
    job,
    async step(name, fn) {
      const cached = await db
        .select({ output: jobSteps.output })
        .from(jobSteps)
        .where(and(eq(jobSteps.jobId, jobId), eq(jobSteps.name, name)))
        .limit(1);
      if (cached[0]) return JSON.parse(cached[0].output) as Awaited<ReturnType<typeof fn>>;
      const output = await steps.runStep(name, async () => {
        try {
          return await fn();
        } catch (err) {
          // Deterministic failures must not be retried by the workflow engine.
          if (
            err instanceof BudgetExceededError ||
            (err instanceof AppError && err.status < 500 && err.status !== 429)
          ) {
            throw steps.nonRetryable(err.message);
          }
          if (err instanceof OpenAIError && !err.retryable) throw steps.nonRetryable(err.message);
          throw err;
        }
      });
      await db
        .insert(jobSteps)
        .values({ jobId, name, output: JSON.stringify(output ?? null), createdAt: Date.now() })
        .onConflictDoNothing();
      await beat();
      return output;
    },
    async setStage(stage) {
      const t = Date.now();
      lastBeat = t;
      await db.update(processingJobs).set({ stage, heartbeatAt: t, updatedAt: t }).where(eq(processingJobs.id, jobId));
    },
    usage(u) {
      return recordUsage(db, { ...u, userId: job.userId, jobId, sessionId: job.sessionId });
    },
    fail(message) {
      throw steps.nonRetryable(message);
    },
  };

  try {
    const handler = getJobHandler(job.jobType);
    if (!handler) throw steps.nonRetryable(`No handler for job type ${job.jobType}`);
    const result = (await handler(ctx)) ?? {};
    const done = Date.now();
    await db
      .update(processingJobs)
      .set({ status: "completed", stage: "done", result, finishedAt: done, updatedAt: done, heartbeatAt: done })
      .where(eq(processingJobs.id, jobId));
    if (row.sessionId) await settleSessionProcessing(db, row.sessionId);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const done = Date.now();
    await db
      .update(processingJobs)
      .set({ status: "failed", error: message.slice(0, 2000), finishedAt: done, updatedAt: done })
      .where(eq(processingJobs.id, jobId));
    if (row.sessionId) await settleSessionProcessing(db, row.sessionId);
    throw err;
  }
}

async function setSessionProcessing(
  db: Db,
  sessionId: string,
  status: "queued" | "processing" | "completed" | "failed",
) {
  await db
    .update(lectureSessions)
    .set({ processingStatus: status, updatedAt: Date.now() })
    .where(and(eq(lectureSessions.id, sessionId), eq(lectureSessions.status, "ready")));
}

/** Derive the lecture's processing status from its remaining jobs. */
export async function settleSessionProcessing(db: Db, sessionId: string) {
  const [active] = await db
    .select({ n: sql<number>`count(*)` })
    .from(processingJobs)
    .where(and(eq(processingJobs.sessionId, sessionId), inArray(processingJobs.status, ["queued", "running"])));
  if ((active?.n ?? 0) > 0) return;
  const [latest] = await db
    .select({ status: processingJobs.status })
    .from(processingJobs)
    .where(eq(processingJobs.sessionId, sessionId))
    .orderBy(sql`${processingJobs.finishedAt} DESC`)
    .limit(1);
  await setSessionProcessing(db, sessionId, latest?.status === "failed" ? "failed" : "completed");
}

/** Step runner for environments without Workflows (next dev): simple retries in-process. */
export const inlineStepRunner: StepRunner = {
  async runStep(name, fn) {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (err instanceof NonRetryableLocal) throw err;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(`Step ${name} failed`);
  },
  nonRetryable(message) {
    return new NonRetryableLocal(message);
  },
};

class NonRetryableLocal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}
