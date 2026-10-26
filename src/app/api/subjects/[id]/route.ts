import { z } from "zod";
import { authedRoute, readJson } from "@/lib/api/route";
import { deleteSubject, getSubject, updateSubject } from "@/lib/data/subjects";
import { SUBJECT_COLORS } from "@/lib/db/schema";

const Patch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  color: z.enum(SUBJECT_COLORS).optional(),
  keywords: z.array(z.string().max(200)).max(100).optional(),
  description: z.string().max(2000).nullish(),
  archived: z.boolean().optional(),
});

export const GET = authedRoute<{ id: string }>(async ({ db, user, params }) => ({
  subject: await getSubject(db, user.id, params.id),
}));

export const PATCH = authedRoute<{ id: string }>(async ({ db, user, params, req }) => ({
  subject: await updateSubject(db, user.id, params.id, await readJson(req, Patch)),
}));

export const DELETE = authedRoute<{ id: string }>(async ({ db, user, params }) => {
  await deleteSubject(db, user.id, params.id);
});
