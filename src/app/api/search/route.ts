import { authedRoute } from "@/lib/api/route";
import { searchAll } from "@/lib/data/search";

export const GET = authedRoute(async ({ db, user, req }) => {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 200);
  if (q.length < 2) return { query: q, hits: [] };
  return { query: q, hits: await searchAll(db, user.id, q) };
});
