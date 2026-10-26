// Durable execution of long-running AI jobs (notes, summaries, exams, ...).
// Each pipeline stage runs as a Workflow step: retried on transient errors,
// never repeated once it succeeded, and resumable after a worker restart.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { runJob, type JobParams } from "../src/lib/jobs/runner";

export class StudyJobWorkflow extends WorkflowEntrypoint<CloudflareEnv, JobParams> {
  async run(event: WorkflowEvent<JobParams>, step: WorkflowStep) {
    const { jobId } = event.payload;
    if (!jobId) throw new NonRetryableError("Missing jobId");
    return runJob(this.env, jobId, {
      // Step outputs are plain JSON (validated by the runner), so the
      // Serializable<T> constraint holds at runtime.
      runStep: <T>(name: string, fn: () => Promise<T>) =>
        step.do(
          name,
          { retries: { limit: 4, delay: "10 seconds", backoff: "exponential" }, timeout: "15 minutes" },
          fn as unknown as () => Promise<never>,
        ) as unknown as Promise<T>,
      nonRetryable: (message) => new NonRetryableError(message),
    });
  }
}
