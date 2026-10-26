import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// End-to-end tests run against `next dev` with the local Cloudflare bindings
// (D1 + R2 emulated by wrangler) and a fake microphone fed from a WAV file.
// Transcription calls reach the real OpenAI API when credentials are present.
const FAKE_AUDIO = path.resolve(__dirname, "tests/fixtures/lecture-es-en.wav");

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  outputDir: "tests/e2e/.artifacts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    permissions: ["microphone"],
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-audio-capture=${FAKE_AUDIO}%noloop`,
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000/login",
        reuseExistingServer: true,
        timeout: 120_000,
        env: { NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY ?? "" },
      },
});
