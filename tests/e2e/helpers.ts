import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

export function uniqueEmail(prefix = "e2e"): string {
  return `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

export const PASSWORD = "correct-horse-battery-staple";

/** Create an account through the UI (sign-up is open while no account exists, or for allowed e-mails). */
export async function signUp(page: Page, email = uniqueEmail()): Promise<string> {
  await page.goto("/signup");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page).toHaveURL(/\/$/);
  return email;
}

/** Same-origin header required by the API's CSRF check. */
export function originHeaders(page: Page): Record<string, string> {
  return { origin: new URL(page.url() || "http://localhost:3000").origin };
}

export async function signUpViaApi(page: Page, email = uniqueEmail()): Promise<string> {
  const res = await page.request.post("/api/auth/signup", {
    data: { email, password: PASSWORD },
    headers: originHeaders(page),
  });
  if (res.status() === 403)
    throw new Error("Sign-up closed: set ALLOWED_SIGNUP_EMAILS or start from an empty database");
  expect(res.ok(), await res.text()).toBeTruthy();
  return email;
}

export async function createSubject(page: Page, name: string): Promise<string> {
  const res = await page.request.post("/api/subjects", {
    data: { name, color: "green", keywords: ["Brussels I bis Regulation", "Article 24"] },
    headers: originHeaders(page),
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as { subject: { id: string } }).subject.id;
}

export async function createLecture(page: Page, title: string, subjectId: string | null): Promise<string> {
  const res = await page.request.post("/api/sessions", { data: { title, subjectId }, headers: originHeaders(page) });
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as { lecture: { id: string } }).lecture.id;
}

interface TranscriptFixture {
  title: string;
  subject?: string;
  segments: { text: string; startS: number; language?: string }[];
}

/**
 * Seed a finished lecture with a transcript fixture through the public API
 * (same calls the recorder makes), so lecture-page features can be tested
 * without microphone input. Returns the lecture id.
 */
export async function seedLecture(
  page: Page,
  opts: { fixture?: string; subjectId?: string | null } = {},
): Promise<{ lectureId: string; segments: number }> {
  const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../fixtures", opts.fixture ?? "lecture-pil-transcript.json"), "utf8"),
  ) as TranscriptFixture;
  const headers = originHeaders(page);
  const lectureId = await createLecture(page, fixture.title, opts.subjectId ?? null);
  let res = await page.request.post(`/api/sessions/${lectureId}/status`, {
    data: { action: "start", transcriptionMode: "turns" },
    headers,
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const segments = fixture.segments.map((s, i) => {
    const words = s.text.split(/\s+/).length;
    const startMs = Math.round(s.startS * 1000);
    const next = fixture.segments[i + 1];
    const endMs = next ? Math.min(Math.round(next.startS * 1000) - 500, startMs + words * 400) : startMs + words * 400;
    return {
      seq: i,
      text: s.text,
      status: "final",
      source: "turns",
      startMs,
      endMs: Math.max(startMs + 1000, endMs),
      language: s.language ?? "und",
      languageSource: "model",
    };
  });
  for (let i = 0; i < segments.length; i += 100) {
    res = await page.request.post(`/api/sessions/${lectureId}/segments`, {
      data: { segments: segments.slice(i, i + 100) },
      headers,
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  res = await page.request.post(`/api/sessions/${lectureId}/status`, {
    data: {
      action: "finalize",
      durationMs: segments[segments.length - 1]!.endMs,
      expectedChunks: 0,
      acceptMissing: true,
    },
    headers,
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return { lectureId, segments: segments.length };
}

export function fixturePath(name: string): string {
  return path.resolve(__dirname, "../fixtures", name);
}
