import type { JobType } from "@/lib/db/schema";
import type { JobHandler } from "../runner";

// Handlers are registered by the feature modules (notes, summaries, exam,
// flashcards, attachments, index). Keeping the registry explicit avoids
// circular imports between the runner and the pipelines.
const registry = new Map<JobType, JobHandler>();

export function registerJobHandler(type: JobType, handler: JobHandler) {
  registry.set(type, handler);
}

export function getJobHandler(type: JobType): JobHandler | undefined {
  return registry.get(type);
}
