import { cn } from "@/lib/cn";
import { subjectHex } from "@/lib/ui/subject-colors";

export function SubjectDot({ color, className }: { color: string | null | undefined; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: subjectHex(color) }}
    />
  );
}
