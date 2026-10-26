import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No incremental cache: every page is dynamic and user-specific.
export default defineCloudflareConfig({});
