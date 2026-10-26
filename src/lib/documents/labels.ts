// Client-safe labels for attachment kinds (the extractor itself is server-only).
import type { AttachmentKind } from "@/lib/db/schema";

export const UNIT_LABEL: Record<AttachmentKind, "página" | "diapositiva" | "fragmento"> = {
  pdf: "página",
  pptx: "diapositiva",
  docx: "fragmento",
};
