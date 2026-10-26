import { authedRoute } from "@/lib/api/route";
import { listLectures } from "@/lib/data/lectures";
import { listSubjects } from "@/lib/data/subjects";
import { getBudget, monthSpend } from "@/lib/cost/usage";
import { isInterrupted } from "@/lib/sessions/state-machine";

export const GET = authedRoute(async ({ db, user }) => {
  const [subjects, recent, open, spend, budget] = await Promise.all([
    listSubjects(db, user.id),
    listLectures(db, user.id, { limit: 12 }),
    listLectures(db, user.id, { statuses: ["recording", "paused", "recovering", "finalizing", "failed"], limit: 10 }),
    monthSpend(db, user.id),
    getBudget(db, user.id),
  ]);
  const now = Date.now();
  return {
    subjects,
    recent,
    recoverable: open.filter(
      (l) => l.status === "finalizing" || l.status === "failed" || isInterrupted(l.status, l.lastHeartbeatAt, now),
    ),
    processing: recent.filter((l) => l.processingStatus === "queued" || l.processingStatus === "processing"),
    pendingNotes: recent.filter((l) => l.status === "ready" && !l.hasNotes && l.processingStatus === "idle"),
    usage: { monthSpendUsd: spend, monthlyBudgetUsd: budget.monthly },
  };
});
