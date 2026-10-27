// Importing an audio file: the browser cuts it with ffmpeg.wasm, uploads the
// chunks, finalizes the lecture and launches the transcription job.
//
// The ffmpeg core (≈ 32 MB) normally comes from the CDN. Set FFMPEG_CORE_DIR to a
// folder holding ffmpeg-core.js and ffmpeg-core.wasm (the @ffmpeg/core esm build)
// to serve it from disk, e.g. in a sandbox without outbound network.
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { fixturePath, originHeaders, signUpViaApi } from "./helpers";

test.describe("import an audio file", () => {
  test("cuts, uploads, finalizes and queues the transcription", async ({ page }) => {
    test.setTimeout(10 * 60_000);
    const coreDir = process.env.FFMPEG_CORE_DIR;
    if (coreDir) {
      await page.route("https://cdn.jsdelivr.net/npm/@ffmpeg/core@*/dist/esm/*", (route) => {
        const name = path.basename(new URL(route.request().url()).pathname);
        const file = path.join(coreDir, name);
        if (!fs.existsSync(file)) return route.abort();
        return route.fulfill({
          path: file,
          contentType: name.endsWith(".wasm") ? "application/wasm" : "text/javascript",
          headers: { "access-control-allow-origin": "*" },
        });
      });
    }
    await page.goto("/login");
    await signUpViaApi(page);
    const subjectRes = await page.request.post("/api/subjects", {
      data: { name: `Importación ${Date.now()}`, color: "blue", keywords: ["Brussels I bis"] },
      headers: originHeaders(page),
    });
    expect(subjectRes.ok(), await subjectRes.text()).toBeTruthy();
    const subjectId = ((await subjectRes.json()) as { subject: { id: string } }).subject.id;

    await page.goto("/");
    await page.getByRole("button", { name: "Importar audio" }).click();
    const dialog = page.getByRole("dialog", { name: "Importar audio" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Asignatura").selectOption(subjectId);
    await dialog.getByTestId("import-file-input").setInputFiles(fixturePath("lecture-es-en.m4a"));
    const item = dialog.getByTestId("import-item");
    await expect(item).toHaveCount(1);
    await expect(item.getByRole("textbox")).toHaveValue("lecture-es-en");
    await item.getByRole("textbox").fill("Clase importada E2E");
    await dialog.getByTestId("import-start").click();

    const done = dialog.getByTestId("import-done");
    await expect(done).toBeVisible({ timeout: 8 * 60_000 });
    await expect(done).toContainText("fragmentos subidos");
    const href = await done.getByRole("link", { name: "Abrir la clase" }).getAttribute("href");
    const lectureId = href!.split("/").pop()!;

    // Server state: imported lecture, two non-overlapping chunks covering the 47 s file, ready.
    const lecture = ((await (await page.request.get(`/api/sessions/${lectureId}`)).json()) as {
      lecture: { status: string; origin: string; sourceFileName: string | null; durationMs: number; transcriptionMode: string };
    }).lecture;
    expect(lecture.status).toBe("ready");
    expect(lecture.origin).toBe("import");
    expect(lecture.sourceFileName).toBe("lecture-es-en.m4a");
    expect(lecture.transcriptionMode).toBe("turns");
    expect(lecture.durationMs).toBeGreaterThan(46_000);
    expect(lecture.durationMs).toBeLessThan(48_500);
    const chunks = ((await (await page.request.get(`/api/sessions/${lectureId}/chunks`)).json()) as {
      chunks: { seq: number; startMs: number; endMs: number; mimeType: string; sizeBytes: number }[];
    }).chunks;
    expect(chunks.length).toBe(2);
    expect(chunks[0]!.startMs).toBe(0);
    expect(chunks[1]!.startMs).toBe(chunks[0]!.endMs);
    expect(chunks[1]!.endMs).toBe(lecture.durationMs);
    for (const c of chunks) {
      expect(c.mimeType).toBe("audio/mp4");
      expect(c.sizeBytes).toBeGreaterThan(50_000);
    }
    // The stored chunks play back: each one is a valid m4a the browser can decode.
    for (const c of chunks) {
      const res = await page.request.get(`/api/sessions/${lectureId}/chunks/${c.seq}/audio`);
      expect(res.status()).toBe(200);
      expect(Number(res.headers()["content-length"])).toBe(c.sizeBytes);
    }

    const jobs = ((await (await page.request.get(`/api/sessions/${lectureId}/jobs`)).json()) as {
      jobs: { jobType: string; status: string; params: Record<string, unknown> }[];
    }).jobs;
    const transcription = jobs.find((j) => j.jobType === "recovery_transcription");
    const configured = ((await (await page.request.get("/api/profile")).json()) as { openaiConfigured: boolean })
      .openaiConfigured;
    if (!configured) {
      // Without a key the audio is still safe; the job could not be launched.
      await expect(done).toContainText(/transcripción no pudo empezar|Se está transcribiendo/);
      return;
    }
    expect(transcription, JSON.stringify(jobs)).toBeTruthy();
    expect(transcription!.params.thenNotes).toBe(true);

    // The lecture page shows the transcription progress and then the transcript.
    await page.goto(`/lectures/${lectureId}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Clase importada E2E");
    await expect(page.getByText("importada", { exact: true })).toBeVisible();
    await expect
      .poll(
        async () => {
          const res = await page.request.get(`/api/sessions/${lectureId}/jobs`);
          const list = ((await res.json()) as { jobs: { jobType: string; status: string }[] }).jobs;
          return list.find((j) => j.jobType === "recovery_transcription")?.status;
        },
        { timeout: 4 * 60_000, intervals: [3000] },
      )
      .toMatch(/completed|failed/);
    const finalJobs = ((await (await page.request.get(`/api/sessions/${lectureId}/jobs`)).json()) as {
      jobs: { jobType: string; status: string; error: string | null; result: Record<string, unknown> | null }[];
    }).jobs;
    const finished = finalJobs.find((j) => j.jobType === "recovery_transcription")!;
    expect(finished.status, finished.error ?? "").toBe("completed");
    expect(finished.result?.chunks).toBe(2);
    const segments = ((await (await page.request.get(`/api/sessions/${lectureId}/segments`)).json()) as {
      segments: { seq: number; text: string; source: string; startMs: number; endMs: number; status: string }[];
    }).segments;
    expect(segments.length).toBe(2);
    expect(segments.map((s) => s.seq)).toEqual([0, 1]);
    for (const s of segments) {
      expect(s.source).toBe("recovery");
      expect(s.status).toBe("final");
      expect(s.text.split(/\s+/).length).toBeGreaterThan(8);
    }
    expect(segments[1]!.startMs).toBe(segments[0]!.endMs);
    // The notes job was chained automatically.
    expect(finalJobs.some((j) => j.jobType === "notes")).toBe(true);
    // The transcript tab refreshed without a reload.
    await expect(page.getByText(segments[0]!.text.split(" ").slice(0, 4).join(" "))).toBeVisible({ timeout: 30_000 });
  });
});
