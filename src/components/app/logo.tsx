import { cn } from "@/lib/cn";

export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="9" className="fill-accent" />
        <path
          d="M9 19.5c2.2 0 2.2-7 4.4-7s2.2 9 4.4 9 2.2-11 4.4-11"
          fill="none"
          className="stroke-accent-foreground"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {withText ? <span className="text-[15px] font-semibold tracking-[-0.01em]">StudyFlow</span> : null}
    </span>
  );
}
