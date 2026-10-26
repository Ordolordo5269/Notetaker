"use client";
import * as React from "react";
import { Tabs as T } from "radix-ui";
import { cn } from "@/lib/cn";

export const Tabs = T.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof T.List>) {
  const ref = React.useRef<HTMLDivElement>(null);
  // On narrow screens the list scrolls horizontally: keep the active tab visible.
  React.useEffect(() => {
    const list = ref.current;
    if (!list) return;
    const reveal = () =>
      list.querySelector<HTMLElement>("[data-state=active]")?.scrollIntoView({ inline: "nearest", block: "nearest" });
    reveal();
    const obs = new MutationObserver(reveal);
    obs.observe(list, { attributes: true, subtree: true, attributeFilter: ["data-state"] });
    return () => obs.disconnect();
  }, []);
  return (
    <T.List
      ref={ref}
      className={cn("flex items-center gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        "relative -mb-px inline-flex h-10 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 text-sm font-medium text-muted transition-colors hover:text-foreground data-[state=active]:border-accent data-[state=active]:text-foreground [&_svg]:size-4",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof T.Content>) {
  return <T.Content className={cn("focus-visible:outline-none", className)} {...props} />;
}
