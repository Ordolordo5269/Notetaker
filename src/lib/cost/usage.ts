import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { processingJobs, profiles, usageEvents } from "@/lib/db/schema";
import { BudgetExceededError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { audioCost, tokenCost } from "./pricing";

export interface UsageInput {
  userId: string;
  sessionId?: string | null;
  jobId?: string | null;
  kind: "live_transcription" | "file_transcription" | "llm" | "embedding";
  model: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  audioSeconds?: number;
}

export function usageCost(u: UsageInput): number {
  if (u.kind === "live_transcription" || u.kind === "file_transcription") {
    return audioCost(u.model, u.audioSeconds ?? 0);
  }
  return tokenCost(u.model, u.inputTokens ?? 0, u.cachedInputTokens ?? 0, u.outputTokens ?? 0);
}

export async function recordUsage(db: Db, u: UsageInput): Promise<number> {
  const cost = usageCost(u);
  const insert = db.insert(usageEvents).values({
    id: newId(),
    userId: u.userId,
    sessionId: u.sessionId ?? null,
    jobId: u.jobId ?? null,
    kind: u.kind,
    model: u.model,
    inputTokens: u.inputTokens ?? 0,
    cachedInputTokens: u.cachedInputTokens ?? 0,
    outputTokens: u.outputTokens ?? 0,
    audioSeconds: u.audioSeconds ?? 0,
    costUsd: cost,
    createdAt: Date.now(),
  });
  if (u.jobId) {
    await db.batch([
      insert,
      db
        .update(processingJobs)
        .set({ costUsd: sql`${processingJobs.costUsd} + ${cost}` })
        .where(eq(processingJobs.id, u.jobId)),
    ]);
  } else {
    await insert;
  }
  return cost;
}

export function monthStart(now = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

export async function monthSpend(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)` })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), gte(usageEvents.createdAt, monthStart())));
  return row?.total ?? 0;
}

export async function getBudget(db: Db, userId: string) {
  const [p] = await db
    .select({ monthly: profiles.monthlyBudgetUsd, perJob: profiles.jobBudgetUsd })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  return { monthly: p?.monthly ?? null, perJob: p?.perJob ?? null };
}

/**
 * Refuse an operation whose estimated cost would exceed the configured
 * monthly or per-job limit. With no limits configured, everything is allowed.
 */
export async function assertBudget(db: Db, userId: string, estimatedUsd: number, opts: { isJob?: boolean } = {}) {
  const budget = await getBudget(db, userId);
  if (opts.isJob && budget.perJob !== null && estimatedUsd > budget.perJob) {
    throw new BudgetExceededError(
      `El coste estimado (${estimatedUsd.toFixed(2)} USD) supera tu límite por tarea (${budget.perJob.toFixed(2)} USD).`,
      { estimatedUsd, perJob: budget.perJob },
    );
  }
  if (budget.monthly !== null) {
    const spent = await monthSpend(db, userId);
    if (spent + estimatedUsd > budget.monthly) {
      throw new BudgetExceededError(
        `Has gastado ${spent.toFixed(2)} USD este mes; esta operación (≈${estimatedUsd.toFixed(2)} USD) superaría tu límite mensual de ${budget.monthly.toFixed(2)} USD.`,
        { estimatedUsd, spent, monthly: budget.monthly },
      );
    }
  }
}
