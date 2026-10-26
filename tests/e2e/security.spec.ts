import fs from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { fixturePath, originHeaders, seedLecture, signUpViaApi } from "./helpers";

/** Every per-user resource must be invisible (404, never 403 or 200) to another signed-in user. */
test.describe("per-user isolation and request hardening", () => {
  test("another user cannot read, change or delete my lecture, documents, attachments or jobs", async ({
    browser,
    page,
  }) => {
    await page.goto("/login");
    await signUpViaApi(page);
    const { lectureId } = await seedLecture(page);
    const headers = originHeaders(page);
    const up = await page.request.post(`/api/sessions/${lectureId}/attachments`, {
      headers,
      multipart: {
        file: {
          name: "slides.pdf",
          mimeType: "application/pdf",
          buffer: fs.readFileSync(fixturePath("slides-brussels.pdf")),
        },
      },
    });
    expect(up.ok(), await up.text()).toBeTruthy();
    const { attachment, job } = (await up.json()) as { attachment: { id: string }; job: { id: string } };

    const other: Page = await (await browser.newContext()).newPage();
    await other.goto("/login");
    await signUpViaApi(other);
    const oh = originHeaders(other);
    const attempts: [string, Promise<{ status(): number }>][] = [
      ["GET lecture", other.request.get(`/api/sessions/${lectureId}`)],
      ["GET segments", other.request.get(`/api/sessions/${lectureId}/segments`)],
      ["GET chunks", other.request.get(`/api/sessions/${lectureId}/chunks`)],
      ["GET attachments", other.request.get(`/api/sessions/${lectureId}/attachments`)],
      ["GET attachment file", other.request.get(`/api/attachments/${attachment.id}/file`)],
      ["GET attachment pages", other.request.get(`/api/attachments/${attachment.id}/pages`)],
      ["DELETE attachment", other.request.delete(`/api/attachments/${attachment.id}`, { headers: oh })],
      ["GET job", other.request.get(`/api/jobs/${job.id}`)],
      ["POST cancel job", other.request.post(`/api/jobs/${job.id}/cancel`, { headers: oh, data: {} })],
      ["PATCH lecture", other.request.patch(`/api/sessions/${lectureId}`, { headers: oh, data: { title: "pwned" } })],
      ["DELETE lecture", other.request.delete(`/api/sessions/${lectureId}`, { headers: oh })],
      [
        "POST marker",
        other.request.post(`/api/sessions/${lectureId}/markers`, {
          headers: oh,
          data: { id: "6f0c1c7e-9f4a-4b7d-8d1e-2a3b4c5d6e7f", type: "note", atMs: 0, note: "x" },
        }),
      ],
      [
        "POST job",
        other.request.post(`/api/sessions/${lectureId}/jobs`, {
          headers: oh,
          data: { type: "flashcards", language: "auto", maxCards: 10 },
        }),
      ],
      ["POST chat", other.request.post(`/api/sessions/${lectureId}/chat`, { headers: oh, data: { message: "hola" } })],
    ];
    for (const [label, p] of attempts) {
      const res = await p;
      expect(res.status(), label).toBe(404);
    }
    // Still intact for the owner.
    expect((await page.request.get(`/api/sessions/${lectureId}`)).status()).toBe(200);
    expect(
      ((await (await page.request.get(`/api/sessions/${lectureId}`)).json()) as { lecture: { title: string } }).lecture
        .title,
    ).not.toBe("pwned");
  });

  test("mutations without a same-origin header are refused and unauthenticated calls get 401", async ({
    page,
    request,
  }) => {
    await page.goto("/login");
    await signUpViaApi(page);
    const noOrigin = await page.request.post("/api/subjects", { data: { name: "x", color: "green" } });
    expect(noOrigin.status()).toBe(403);
    const crossOrigin = await page.request.post("/api/subjects", {
      data: { name: "x", color: "green" },
      headers: { origin: "https://evil.example" },
    });
    expect(crossOrigin.status()).toBe(403);
    expect((await request.get("/api/dashboard")).status()).toBe(401);
    expect((await request.get("/api/sessions/00000000-0000-0000-0000-000000000000")).status()).toBe(401);
    const secret = await request.post("/api/realtime/client-secret", { data: {}, headers: originHeaders(page) });
    expect(secret.status()).toBe(401);
  });

  test("the session cookie is HttpOnly and SameSite, and sign-in is rate limited by attempts", async ({ page }) => {
    await page.goto("/login");
    const email = await signUpViaApi(page);
    const cookies = await page.context().cookies();
    const session = cookies.find((c) => c.name === "sf_session");
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("Lax");
    // Wrong passwords: after the limit, the account is temporarily locked for that IP.
    const headers = originHeaders(page);
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (
        await page.request.post("/api/auth/login", { data: { email, password: "wrong-password" }, headers })
      ).status();
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});
