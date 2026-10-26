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
function originHeaders(page: Page): Record<string, string> {
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
