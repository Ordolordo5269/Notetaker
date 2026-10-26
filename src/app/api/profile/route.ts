import { z } from "zod";
import { authedRoute, readJson } from "@/lib/api/route";
import { getProfile, updateProfile } from "@/lib/data/profile";
import { getBudget, monthSpend } from "@/lib/cost/usage";
import { PRICING_CHECKED_AT } from "@/lib/cost/pricing";
import { openaiConfigured } from "@/lib/openai/client";

const Patch = z.object({
  notesLanguage: z.enum(["auto", "es", "en", "bilingual"]).optional(),
  removeFillers: z.boolean().optional(),
  transcriptionDelay: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
  audioReviewEnabled: z.boolean().optional(),
  audioRetentionDays: z.number().int().min(1).max(3650).nullable().optional(),
  monthlyBudgetUsd: z.number().min(0).max(10_000).nullable().optional(),
  jobBudgetUsd: z.number().min(0).max(10_000).nullable().optional(),
  acknowledgeRecordingNotice: z.boolean().optional(),
});

export const GET = authedRoute(async ({ db, user, config }) => {
  const [profile, spend, budget] = await Promise.all([
    getProfile(db, user.id),
    monthSpend(db, user.id),
    getBudget(db, user.id),
  ]);
  return {
    user,
    profile,
    usage: { monthSpendUsd: spend, ...budget, pricingCheckedAt: PRICING_CHECKED_AT },
    models: config.models,
    openaiConfigured: openaiConfigured(config),
  };
});

export const PATCH = authedRoute(async ({ db, user, req }) => ({
  profile: await updateProfile(db, user.id, await readJson(req, Patch)),
}));
