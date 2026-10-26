import { authedRoute } from "@/lib/api/route";
import { listAttachmentPages } from "@/lib/data/attachments";

export const GET = authedRoute<{ attachmentId: string }>(async ({ db, user, params }) => ({
  pages: await listAttachmentPages(db, user.id, params.attachmentId),
}));
