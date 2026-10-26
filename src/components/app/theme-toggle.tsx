"use client";
import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";

type Theme = "light" | "dark" | "system";

function apply(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = React.useState<Theme>(() => {
    if (typeof window === "undefined") return "system";
    try {
      return (localStorage.getItem("sf-theme") as Theme) || "system";
    } catch {
      return "system";
    }
  });

  React.useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  function choose(t: Theme) {
    setTheme(t);
    try {
      localStorage.setItem("sf-theme", t);
    } catch {
      /* private mode */
    }
    apply(t);
  }

  const options: { value: Theme; icon: React.ReactNode; label: string }[] = [
    { value: "light", icon: <Sun />, label: "Claro" },
    { value: "dark", icon: <Moon />, label: "Oscuro" },
    { value: "system", icon: <Monitor />, label: "Sistema" },
  ];
  return (
    <div role="radiogroup" aria-label="Tema" className={cn("flex rounded-lg bg-sunken p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={theme === o.value}
          aria-label={o.label}
          title={o.label}
          onClick={() => choose(o.value)}
          suppressHydrationWarning
          className={cn(
            "flex h-7 flex-1 items-center justify-center rounded-md text-muted transition-colors [&_svg]:size-3.5",
            theme === o.value && "bg-surface text-foreground shadow-soft",
          )}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}
