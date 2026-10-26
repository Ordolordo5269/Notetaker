import { authedRoute } from "@/lib/api/route";
import { cancelJob } from "@/lib/jobs/queue";

export const POST = authedRoute<{ jobId: string }>(async ({ db, user, params }) => ({
  job: await cancelJob(db, user.id, params.jobId),
}));
