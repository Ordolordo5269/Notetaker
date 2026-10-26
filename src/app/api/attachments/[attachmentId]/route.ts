import { authedRoute } from "@/lib/api/route";
import { deleteAttachment } from "@/lib/data/attachments";

export const DELETE = authedRoute<{ attachmentId: string }>(async ({ db, env, user, params }) => {
  await deleteAttachment(db, env.FILES, user.id, params.attachmentId);
});
