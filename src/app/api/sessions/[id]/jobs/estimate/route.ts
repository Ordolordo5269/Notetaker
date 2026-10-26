import { authedRoute, readJson } from "@/lib/api/route";
import { getLectureRow } from "@/lib/data/lectures";
import { getBudget, monthSpend } from "@/lib/cost/usage";
import { estimateJob, jobRequestSchema } from "@/lib/jobs/requests";

/** Cost estimate for a job before launching it. */
export const POST = authedRoute<{ id: string }>(async ({ db, user, params, req, config }) => {
  const body = await readJson(req, jobRequestSchema);
  await getLectureRow(db, user.id, params.id);
  const [estimate, budget, spent] = await Promise.all([
    estimateJob(db, config, user.id, params.id, body),
    getBudget(db, user.id),
    monthSpend(db, user.id),
  ]);
  return { estimate, budget: { ...budget, monthSpendUsd: spent } };
});
