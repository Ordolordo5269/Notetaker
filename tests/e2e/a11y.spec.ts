import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { fixturePath, originHeaders, seedLecture, signUpViaApi } from "./helpers";

// WCAG 2.1 AA (plus axe best practices) on every main screen, light and dark.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

async function expectAccessible(page: import("@playwright/test").Page, name: string) {
  // Audit the settled page (queries resolved, panels rendered), not a loading skeleton.
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} nodes, e.g. ${v.nodes[0]?.target?.[0]}`,
  );
  expect(summary, `${name} has accessibility violations`).toEqual([]);
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`accessibility (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    test(`main screens have no axe violations in ${scheme} mode`, async ({ page }) => {
      await page.addInitScript((theme) => localStorage.setItem("sf-theme", theme), scheme);
      await page.goto("/login");
      await expectAccessible(page, "login");
      await page.goto("/signup");
      await expectAccessible(page, "signup");
      await page.goto("/offline");
      await expectAccessible(page, "offline");

      await signUpViaApi(page);
      const { lectureId } = await seedLecture(page);
      const up = await page.request.post(`/api/sessions/${lectureId}/attachments`, {
        headers: originHeaders(page),
        multipart: {
          file: {
            name: "slides.pdf",
            mimeType: "application/pdf",
            buffer: fs.readFileSync(fixturePath("slides-brussels.pdf")),
          },
        },
      });
      expect(up.ok()).toBeTruthy();

      for (const [name, url] of [
        ["dashboard", "/"],
        ["subjects", "/subjects"],
        ["search", "/search?q=jurisdiction"],
        ["settings", "/settings"],
        ["review", "/review"],
      ] as const) {
        await page.goto(url);
        await page.waitForSelector("main");
        await expectAccessible(page, name);
      }
      for (const tab of ["transcript", "notes", "summary", "exam", "flashcards", "chat", "documents"]) {
        await page.goto(`/lectures/${lectureId}?tab=${tab}`);
        await page.waitForSelector("main");
        if (tab === "transcript") await page.waitForSelector("[data-testid=transcript]");
        if (tab === "documents") await page.getByText("slides.pdf").first().waitFor();
        await expectAccessible(page, `lecture:${tab}`);
      }
      const res = await page.request.post("/api/sessions", {
        data: { title: "A11y", subjectId: null },
        headers: originHeaders(page),
      });
      const { lecture } = (await res.json()) as { lecture: { id: string } };
      await page.goto(`/record/${lecture.id}`);
      await page.getByRole("heading", { name: "Lista para grabar" }).waitFor();
      await expectAccessible(page, "record");
    });
  });
}
