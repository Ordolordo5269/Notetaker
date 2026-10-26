import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createLecture, createSubject, signUpViaApi } from "./helpers";

const expected = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../fixtures/lecture-es-en.json"), "utf8"),
) as Record<string, string>;

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

test.describe("recording a bilingual lecture", () => {
  test("records, transcribes in the original language, finalizes and plays back", async ({ page }) => {
    await page.goto("/login");
    await signUpViaApi(page);
    const subjectId = await createSubject(page, "Private International Law");
    const lectureId = await createLecture(page, "Jurisdiction under Brussels I bis", subjectId);

    await page.goto(`/record/${lectureId}`);
    await expect(page.getByRole("heading", { name: "Lista para grabar" })).toBeVisible();
    await page.getByRole("button", { name: "Iniciar grabación" }).click();
    await expect(page.getByText("Grabando", { exact: true })).toBeVisible({ timeout: 30_000 });

    // The fake microphone plays ~47 s of audio (EN, ES, mixed). Wait for transcript text.
    const transcript = page.getByTestId("transcript");
    await expect(transcript.getByText(/Brussels I bis/i).first()).toBeVisible({ timeout: 120_000 });
    await expect(transcript.getByText(/Bruselas I bis/i).first()).toBeVisible({ timeout: 120_000 });

    // Markers while recording.
    await page.getByRole("button", { name: "Importante" }).click();
    await page.getByRole("button", { name: "Posible examen" }).click();

    // Pause / resume must not break anything.
    await page.getByRole("button", { name: "Pausar" }).click();
    await expect(page.getByText("En pausa", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Reanudar" }).click();
    await expect(page.getByText("Grabando", { exact: true })).toBeVisible();

    // Let the rest of the audio play, then wait until the last clip is transcribed.
    await expect(transcript.getByText(/una excepci/i).first()).toBeVisible({ timeout: 150_000 });
    await page.waitForTimeout(3000);

    await page.getByRole("button", { name: "Finalizar" }).click();
    await page.getByRole("button", { name: "Finalizar clase" }).click();
    await expect(page).toHaveURL(new RegExp(`/lectures/${lectureId}`), { timeout: 120_000 });

    // Lecture page: transcript in the original languages, no translation.
    const segments = (await (await page.request.get(`/api/sessions/${lectureId}/segments`)).json()) as {
      segments: { text: string; language: string; status: string }[];
    };
    const finals = segments.segments.filter((s) => s.status === "final");
    expect(finals.length).toBeGreaterThanOrEqual(4);
    const joined = norm(finals.map((s) => s.text).join(" "));
    for (const key of ["en", "es", "mixed", "mix2"]) {
      const words = norm(expected[key]!).split(" ");
      // Require most of the sentence's words to be present (ASR may vary punctuation).
      const present = words.filter((w) => joined.includes(w)).length;
      expect(present / words.length, `clip ${key} should be transcribed verbatim`).toBeGreaterThan(0.8);
    }
    // No translation: English clips must not appear in Spanish and vice versa.
    expect(joined).not.toContain("hoy vamos a estudiar el reglamento bruselas i bis regulation");
    expect(joined).not.toMatch(/today we are going to study the regulation brussels/);
    const langs = new Set(finals.map((s) => s.language));
    expect(langs.has("en") || langs.has("mixed")).toBeTruthy();
    expect(langs.has("es") || langs.has("mixed")).toBeTruthy();

    // Audio is stored: chunk list is non-empty and bytes are served.
    const chunks = (await (await page.request.get(`/api/sessions/${lectureId}/chunks`)).json()) as {
      chunks: { seq: number; sizeBytes: number }[];
    };
    expect(chunks.chunks.length).toBeGreaterThanOrEqual(1);
    const audio = await page.request.get(`/api/sessions/${lectureId}/chunks/0/audio`);
    expect(audio.ok()).toBeTruthy();
    expect(Number(audio.headers()["content-length"])).toBe(chunks.chunks[0]!.sizeBytes);

    // Markers persisted.
    const markers = (await (await page.request.get(`/api/sessions/${lectureId}/markers`)).json()) as {
      markers: { type: string }[];
    };
    expect(markers.markers.map((m) => m.type).sort()).toEqual(["exam", "important"]);

    // UI: player and transcript tab render; clean view works; export downloads.
    await expect(page.getByRole("button", { name: "Reproducir" })).toBeVisible();
    await expect(
      page
        .getByTestId("transcript")
        .getByText(/Brussels I bis/i)
        .first(),
    ).toBeVisible();
    await page.getByRole("radio", { name: "Limpia" }).click();
    await expect(
      page
        .locator(".prose-study")
        .getByText(/Bruselas I bis/i)
        .first(),
    ).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page
        .getByRole("button", { name: "Exportar" })
        .click()
        .then(() => page.getByRole("menuitem", { name: "Texto plano" }).click()),
    ]);
    const file = await download.path();
    const content = fs.readFileSync(file!, "utf8");
    expect(content).toMatch(/Brussels I bis/i);
    expect(content).toMatch(/Bruselas I bis/i);

    // Playback: seeking to a transcript line starts the audio.
    await page.getByRole("radio", { name: "Original" }).click();
    await page.getByRole("button", { name: /Reproducir/ }).click();
    await expect(page.getByRole("button", { name: "Pausar" })).toBeVisible({ timeout: 20_000 });
  });

  test("survives a page reload mid-recording and offers recovery", async ({ page }) => {
    await page.goto("/login");
    await signUpViaApi(page);
    const lectureId = await createLecture(page, "Reload during class", null);
    await page.goto(`/record/${lectureId}`);
    await page.getByRole("button", { name: "Iniciar grabación" }).click();
    await expect(page.getByText("Grabando", { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(12_000);

    // Simulate an accidental reload (beforeunload dialogs are auto-dismissed by Playwright).
    page.on("dialog", (d) => d.accept());
    await page.reload();
    await expect(page.getByRole("heading", { name: "Sesión interrumpida" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Tiempo grabado/)).toBeVisible();

    await page.getByRole("button", { name: "Continuar grabando" }).click();
    await expect(page.getByText("Grabando", { exact: true })).toBeVisible({ timeout: 30_000 });
    // The gap is made explicit in the transcript.
    await expect(page.getByText(/Intervalo no grabado/)).toBeVisible();
    await page.waitForTimeout(8_000);
    await page.getByRole("button", { name: "Finalizar" }).click();
    await page.getByRole("button", { name: "Finalizar clase" }).click();
    await expect(page).toHaveURL(new RegExp(`/lectures/${lectureId}`), { timeout: 120_000 });

    const chunks = (await (await page.request.get(`/api/sessions/${lectureId}/chunks`)).json()) as {
      chunks: { seq: number; partial: boolean }[];
    };
    expect(chunks.chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.chunks.some((c) => c.partial)).toBeTruthy();
  });
});
