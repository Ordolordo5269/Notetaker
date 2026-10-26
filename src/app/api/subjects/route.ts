import { z } from "zod";
import { authedRoute, readJson } from "@/lib/api/route";
import { createSubject, listSubjects } from "@/lib/data/subjects";
import { SUBJECT_COLORS } from "@/lib/db/schema";

const Create = z.object({
  name: z.string().trim().min(1).max(120),
  color: z.enum(SUBJECT_COLORS).default("green"),
  keywords: z.array(z.string().max(200)).max(100).optional(),
  description: z.string().max(2000).nullish(),
});

export const GET = authedRoute(async ({ db, user, req }) => ({
  subjects: await listSubjects(db, user.id, { includeArchived: req.nextUrl.searchParams.get("archived") === "1" }),
}));

export const POST = authedRoute(async ({ db, user, req }) => {
  const body = await readJson(req, Create);
  return { subject: await createSubject(db, user.id, body) };
});
