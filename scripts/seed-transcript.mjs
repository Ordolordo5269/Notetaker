#!/usr/bin/env node
// Seeds a finished lecture with a transcript fixture through the public API,
// so the AI pipelines can be exercised without recording audio.
//
//   node scripts/seed-transcript.mjs [--base http://localhost:3000] [--email you@x.y] [--password ...]
//                                    [--fixture tests/fixtures/lecture-pil-transcript.json]
//
// The account is created if it does not exist (sign-up must be allowed).
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1] ?? ""] : [])).filter((p) => p.length),
);
const base = args.base ?? "http://localhost:3000";
const email = args.email ?? `seed+${Date.now()}@example.com`;
const password = args.password ?? "correct-horse-battery-staple";
const fixturePath = path.resolve(args.fixture ?? "tests/fixtures/lecture-pil-transcript.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

let cookie = "";
async function call(method, p, body) {
  const res = await fetch(base + p, {
    method,
    headers: { "Content-Type": "application/json", Origin: base, ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

let signedUp = true;
try {
  await call("POST", "/api/auth/signup", { email, password });
} catch {
  signedUp = false;
  await call("POST", "/api/auth/login", { email, password });
}
console.log(`${signedUp ? "Created" : "Signed in as"} ${email}`);

let subjectId = null;
if (fixture.subject) {
  const { subjects } = await call("GET", "/api/subjects");
  subjectId = subjects.find((s) => s.name === fixture.subject)?.id ?? null;
  if (!subjectId) {
    subjectId = (await call("POST", "/api/subjects", { name: fixture.subject, color: "green" })).subject.id;
  }
}

const { lecture } = await call("POST", "/api/sessions", { title: fixture.title, subjectId });
await call("POST", `/api/sessions/${lecture.id}/status`, { action: "start", transcriptionMode: "turns" });

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
  await call("POST", `/api/sessions/${lecture.id}/segments`, { segments: segments.slice(i, i + 100) });
}
const durationMs = segments[segments.length - 1].endMs;
await call("POST", `/api/sessions/${lecture.id}/status`, {
  action: "finalize",
  durationMs,
  expectedChunks: 0,
  acceptMissing: true,
});
console.log(`Lecture ready: ${base}/lectures/${lecture.id}`);
console.log(JSON.stringify({ email, password, lectureId: lecture.id, segments: segments.length, durationMs }));
