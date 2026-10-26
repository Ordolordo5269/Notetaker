import { test, expect } from "@playwright/test";
import { fixturePath, originHeaders, seedLecture, signUpViaApi } from "./helpers";

test.describe("lecture documents (slides)", () => {
  test("uploads a PDF and a PPTX, extracts page text, flags a scanned PDF, hands a page to the chat", async ({
    page,
  }) => {
    await page.goto("/login");
    await signUpViaApi(page);
    const { lectureId } = await seedLecture(page);

    // Reject a file whose bytes do not match its extension.
    const bad = await page.request.post(`/api/sessions/${lectureId}/attachments`, {
      headers: originHeaders(page),
      multipart: {
        file: { name: "evil.pdf", mimeType: "application/pdf", buffer: Buffer.from("PK\u0003\u0004 not a pdf") },
      },
    });
    expect(bad.status()).toBe(400);

    await page.goto(`/lectures/${lectureId}?tab=documents`);
    await expect(page.getByText("Diapositivas y documentos del profesor")).toBeVisible();
    await page
      .locator("#attachment-input")
      .setInputFiles([
        fixturePath("slides-brussels.pdf"),
        fixturePath("slides-brussels.pptx"),
        fixturePath("scanned-blank.pdf"),
      ]);

    // Extraction runs as a background job; the list polls until it settles.
    const pdfCard = page.locator("li", { hasText: "slides-brussels.pdf" });
    const pptxCard = page.locator("li", { hasText: "slides-brussels.pptx" });
    const scannedCard = page.locator("li", { hasText: "scanned-blank.pdf" });
    await expect(pdfCard.getByText("Texto extraído")).toBeVisible({ timeout: 60_000 });
    await expect(pdfCard.getByText("5 páginas")).toBeVisible();
    await expect(pptxCard.getByText("Texto extraído")).toBeVisible({ timeout: 60_000 });
    await expect(pptxCard.getByText("5 diapositivas")).toBeVisible();
    await expect(scannedCard.getByText("Sin texto legible")).toBeVisible({ timeout: 60_000 });

    // Page viewer shows the extracted text of the selected document.
    await pptxCard.getByRole("button").click();
    await expect(page.getByText("Special jurisdiction (Art. 7)")).toBeVisible();
    await expect(page.getByText("DIAPOSITIVA 4", { exact: false })).toBeVisible();

    // "Preguntar" prefills the chat with a question about that slide.
    await page
      .locator("li[id^='page-']", { hasText: "Special jurisdiction (Art. 7)" })
      .getByRole("button", { name: "Preguntar" })
      .click();
    const draft = page.getByLabel("Pregunta");
    await expect(draft).toBeVisible();
    await expect(draft).toHaveValue(/diapositiva 4 de "slides-brussels.pptx"/);

    // The scanned PDF explains why the AI cannot read it, and the file can still be downloaded.
    await page.goto(`/lectures/${lectureId}?tab=documents`);
    await scannedCard.getByRole("button").click();
    await expect(page.getByText("no contiene texto legible", { exact: false })).toBeVisible();
    const download = await page.request.get(
      (await page.getByRole("link", { name: "Descargar" }).getAttribute("href")) ?? "",
    );
    expect(download.ok()).toBeTruthy();
    expect(download.headers()["content-disposition"]).toContain("scanned-blank.pdf");
  });
});
