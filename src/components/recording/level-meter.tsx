"use client";
import { Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/cn";

export function LevelMeter({
  level,
  lost,
  speaking,
  className,
}: {
  level: number;
  lost: boolean;
  speaking: boolean;
  className?: string;
}) {
  const bars = 12;
  const lit = Math.round(Math.min(1, level) * bars);
  return (
    <div
      className={cn("flex items-center gap-2", className)}
      aria-label={lost ? "Micrófono desconectado" : `Nivel de micrófono ${Math.round(level * 100)}%`}
      role="img"
    >
      {lost ? (
        <MicOff className="size-4 text-danger" />
      ) : (
        <Mic className={cn("size-4", speaking ? "text-accent" : "text-muted")} />
      )}
      <div className="flex h-4 items-end gap-[3px]" aria-hidden>
        {Array.from({ length: bars }, (_, i) => (
          <span
            key={i}
            className={cn(
              "w-[3px] rounded-sm transition-colors duration-75",
              i < lit ? (i > bars - 3 ? "bg-warning" : "bg-accent") : "bg-border-strong",
            )}
            style={{ height: `${35 + (i / bars) * 65}%` }}
          />
        ))}
      </div>
    </div>
  );
}
