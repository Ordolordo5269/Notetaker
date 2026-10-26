import * as React from "react";
import { cn } from "@/lib/cn";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-sunken", className)} {...props} />;
}

const badgeTones = {
  neutral: "bg-sunken text-muted border-border",
  accent: "bg-accent-soft text-accent-soft-foreground border-transparent",
  warning: "bg-warning-soft text-warning border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
  outline: "bg-transparent text-muted border-border",
} as const;

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof badgeTones }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11.5px] font-medium leading-none [&_svg]:size-3",
        badgeTones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-surface px-1 font-mono text-[11px] text-muted",
        className,
      )}
      {...props}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("size-4 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-strong px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? <div className="mb-3 text-subtle [&_svg]:size-6">{icon}</div> : null}
      <p className="text-[15px] font-medium">{title}</p>
      {description ? <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Callout({
  tone = "neutral",
  icon,
  title,
  children,
  className,
  action,
}: {
  tone?: "neutral" | "accent" | "warning" | "danger";
  icon?: React.ReactNode;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  const tones = {
    neutral: "border-border bg-sunken",
    accent: "border-transparent bg-accent-soft text-accent-soft-foreground",
    warning: "border-transparent bg-warning-soft",
    danger: "border-transparent bg-danger-soft",
  } as const;
  const iconTones = { neutral: "text-muted", accent: "", warning: "text-warning", danger: "text-danger" } as const;
  return (
    <div role="status" className={cn("flex gap-3 rounded-xl border px-4 py-3 text-sm", tones[tone], className)}>
      {icon ? <div className={cn("mt-0.5 shrink-0 [&_svg]:size-4", iconTones[tone])}>{icon}</div> : null}
      <div className="min-w-0 flex-1 leading-relaxed">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn(title ? "mt-0.5" : "", "text-[13.5px] opacity-90")}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}

export function SectionHeading({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-end justify-between gap-4", className)}>
      <div>
        <h2 className="text-[15px] font-semibold tracking-[-0.005em]">{title}</h2>
        {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
