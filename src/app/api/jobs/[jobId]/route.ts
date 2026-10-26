import { authedRoute } from "@/lib/api/route";
import { getJob } from "@/lib/jobs/queue";

export const GET = authedRoute<{ jobId: string }>(async ({ db, user, params }) => ({
  job: await getJob(db, user.id, params.jobId),
}));
