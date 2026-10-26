import { authedRoute } from "@/lib/api/route";

export const GET = authedRoute(async ({ user }) => ({ user }));
