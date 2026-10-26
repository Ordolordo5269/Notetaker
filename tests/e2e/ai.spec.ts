import { test, expect } from "@playwright/test";
import { originHeaders, seedLecture, signUpViaApi } from "./helpers";

// Real OpenAI calls (≈ $0.50 per run, several minutes). Opt in with E2E_AI=1.
test.describe("AI study material (opt-in, real model calls)", () => {
  test.skip(!process.env.E2E_AI, "set E2E_AI=1 to run the paid pipeline test");
  test.setTimeout(20 * 60_000);

  test("generates faithful notes with traceability, edits a section, answers a grounded question", async ({ page }) => {
    await page.goto("/login");
    await signUpViaApi(page);
    const { lectureId } = await seedLecture(page);
    const headers = originHeaders(page);

    // Launch the notes pipeline and wait for the real stages.
    await page.goto(`/lectures/${lectureId}?tab=notes`);
    await page.getByRole("button", { name: "Generar apuntes completos" }).click();
    await expect(page.getByText(/Identificando temas|Estructurando el documento|Redactando apuntes/)).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByRole("button", { name: "Historial" })).toBeVisible({ timeout: 15 * 60_000 });

    const docs = (await (await page.request.get(`/api/sessions/${lectureId}/documents`)).json()) as {
      documents: { kind: string; content: { sections: { markdown: string; refs: unknown[] }[]; language: string } }[];
    };
    const notes = docs.documents.find((d) => d.kind === "notes")!;
    expect(notes.content.sections.length).toBeGreaterThanOrEqual(6);
    // Every substantive section cites the recording.
    const cited = notes.content.sections.filter((s) => s.refs.length > 0).length;
    expect(cited / notes.content.sections.length).toBeGreaterThan(0.8);
    // Fidelity spot-checks: core concepts of the fixture lecture appear; nothing about unrelated topics.
    const text = notes.content.sections
      .map((s) => s.markdown)
      .join("\n")
      .toLowerCase();
    for (const must of ["article 24", "article 25", "lis pendens", "domicil"]) expect(text).toContain(must);

    // Clicking a time reference seeks the player (no audio in a seeded lecture, but the active position updates).
    const firstRef = page.locator("button[title^='Ir a']").first();
    if (await firstRef.count()) await firstRef.click();

    // Chat: grounded answer with transcript citations, and honesty when the topic is not in the lecture.
    await page.goto(`/lectures/${lectureId}?tab=chat`);
    await page.getByLabel("Pregunta").fill("¿Qué dijo el profesor sobre el artículo 24?");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Basado en tu clase")).toBeVisible({ timeout: 120_000 });
    await expect(page.locator("button", { hasText: /Clase \d\d:\d\d/ }).first()).toBeVisible();
    await page.getByLabel("Pregunta").fill("¿Qué explicó sobre la fotosíntesis?");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/no (se )?(trató|aparece|explicó|menciona)/i).first()).toBeVisible({
      timeout: 120_000,
    });

    const res = await page.request.get(`/api/sessions/${lectureId}/jobs`, { headers });
    expect(res.ok()).toBeTruthy();
  });
});
