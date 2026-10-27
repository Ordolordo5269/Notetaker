import { z } from "zod";
import { authedRoute, readJson } from "@/lib/api/route";
import { createLecture, listLectures } from "@/lib/data/lectures";
import { SESSION_STATUSES } from "@/lib/db/schema";

const Create = z.object({
  title: z.string().trim().min(1).max(200),
  subjectId: z.string().uuid().nullish(),
  keywords: z.array(z.string().max(200)).max(100).optional(),
  // Imported audio file (the browser cuts it into chunks and uploads them like a recording).
  origin: z.enum(["live", "import"]).optional(),
  sourceFileName: z.string().trim().min(1).max(255).optional(),
});

export const GET = authedRoute(async ({ db, user, req }) => {
  const sp = req.nextUrl.searchParams;
  const statuses = sp
    .getAll("status")
    .filter((s): s is (typeof SESSION_STATUSES)[number] => (SESSION_STATUSES as readonly string[]).includes(s));
  return {
    lectures: await listLectures(db, user.id, {
      subjectId: sp.get("subjectId"),
      statuses,
      limit: Number(sp.get("limit") ?? 50),
      before: sp.get("before") ? Number(sp.get("before")) : undefined,
    }),
  };
});

export const POST = authedRoute(async ({ db, user, req }) => {
  const body = await readJson(req, Create);
  return { lecture: await createLecture(db, user.id, body) };
});
