#!/usr/bin/env node
// Runs a processing job in-process against the local wrangler bindings
// (D1 + R2 in .wrangler/state). Useful to debug pipelines without the dev server:
//   node scripts/run-job.mjs <jobId>
import { getPlatformProxy } from "wrangler";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const jobId = process.argv[2];
if (!jobId) {
  console.error("usage: node scripts/run-job.mjs <jobId>");
  process.exit(1);
}
register("tsx/esm", pathToFileURL("./"));
const { env, dispose } = await getPlatformProxy({ configPath: "wrangler.jsonc", persist: true });
try {
  await import("../src/lib/jobs/register.ts");
  const { runJob, inlineStepRunner } = await import("../src/lib/jobs/runner.ts");
  const result = await runJob(env, jobId, inlineStepRunner);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await dispose();
}
