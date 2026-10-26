import "@/lib/jobs/register";
import { authedRoute } from "@/lib/api/route";
import { retryJob } from "@/lib/jobs/queue";

/** Re-run a failed or cancelled job, reusing the steps it already completed. */
export const POST = authedRoute<{ jobId: string }>(async ({ db, env, user, params }) => ({
  job: await retryJob(env, db, user.id, params.jobId),
}));
