"use client";
import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, Ear } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import type { TurnView } from "@/lib/recording/session-controller";
import { formatClock } from "@/lib/time";

const LANG_LABEL: Record<TurnView["language"], string> = { es: "ES", en: "EN", mixed: "ES·EN", und: "" };

export function LanguageChip({
  language,
  source,
  className,
}: {
  language: TurnView["language"];
  source: "heuristic" | "model";
  className?: string;
}) {
  if (language === "und") return null;
  return (
    <Tooltip
      content={
        source === "model" ? "Idioma identificado por el modelo de transcripción" : "Idioma estimado a partir del texto"
      }
    >
      <span
        className={cn(
          "inline-flex h-4 items-center rounded px-1 font-mono text-[10px] tracking-wide text-muted",
          className,
        )}
      >
        {LANG_LABEL[language]}
        {source === "heuristic" ? <span className="ml-0.5 opacity-60">~</span> : null}
      </span>
    </Tooltip>
  );
}

function TurnRow({ turn, onSeek, active }: { turn: TurnView; onSeek?: (ms: number) => void; active?: boolean }) {
  const provisional = turn.state === "provisional" || turn.state === "listening";
  const processing = turn.state === "processing";
  const Comp = onSeek ? "button" : "div";
  if (turn.state === "gap") {
    return (
      <div className="my-2 flex items-center gap-3 text-[12.5px] text-warning">
        <span className="h-px flex-1 bg-warning/30" />
        <span>
          {formatClock(turn.startMs)} · {turn.text}
        </span>
        <span className="h-px flex-1 bg-warning/30" />
      </div>
    );
  }
  return (
    <Comp
      type={onSeek ? "button" : undefined}
      onClick={onSeek ? () => onSeek(turn.startMs) : undefined}
      className={cn(
        "group grid w-full grid-cols-[52px_1fr] gap-x-3 rounded-lg px-2 py-1.5 text-left sm:grid-cols-[64px_1fr]",
        onSeek && "transition-colors hover:bg-sunken",
        active && "bg-accent-soft/60",
      )}
    >
      <span className="pt-[5px] font-mono text-[11.5px] tabular-nums text-subtle">{formatClock(turn.startMs)}</span>
      <span className="min-w-0">
        <span
          className={cn(
            "text-[17px] leading-[1.7] sm:text-[18px]",
            provisional && "text-muted",
            processing && "text-muted",
            turn.state === "failed" && "text-danger",
          )}
        >
          {turn.state === "listening" && !turn.text ? (
            <span className="inline-flex items-center gap-1.5 text-[14px] text-subtle">
              <Ear className="size-3.5 animate-pulse-dot" /> Escuchando…
            </span>
          ) : processing && !turn.text ? (
            <span className="text-[14px] text-subtle">
              Transcribiendo fragmento de {formatClock(turn.startMs)}–{formatClock(turn.endMs ?? turn.startMs)}…
            </span>
          ) : turn.state === "failed" && !turn.text ? (
            <span className="text-[14px]">
              No se pudo transcribir este fragmento ({formatClock(turn.startMs)}). El audio se conserva.
            </span>
          ) : (
            turn.text
          )}
          {provisional && turn.text ? (
            <span
              className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse-dot bg-muted"
              aria-hidden
            />
          ) : null}
        </span>
        {turn.state === "final" ? (
          <LanguageChip language={turn.language} source={turn.languageSource} className="ml-1.5 align-middle" />
        ) : null}
      </span>
    </Comp>
  );
}

export function TranscriptView({
  turns,
  follow = true,
  onSeek,
  activeMs,
  className,
  emptyHint,
}: {
  turns: TurnView[];
  /** Auto-scroll as new text arrives (recording screen). */
  follow?: boolean;
  onSeek?: (ms: number) => void;
  activeMs?: number;
  className?: string;
  emptyHint?: React.ReactNode;
}) {
  const parentRef = React.useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = React.useState(true);
  const virtualizer = useVirtualizer({
    count: turns.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 8,
    getItemKey: (i) => turns[i]!.seq,
  });

  const lastKey = turns.length ? `${turns[turns.length - 1]!.seq}:${turns[turns.length - 1]!.text.length}` : "";
  React.useEffect(() => {
    if (!follow || !pinned || !turns.length) return;
    virtualizer.scrollToIndex(turns.length - 1, { align: "end" });
    // Second pass after dynamic measurement.
    const id = requestAnimationFrame(() => virtualizer.scrollToIndex(turns.length - 1, { align: "end" }));
    return () => cancelAnimationFrame(id);
  }, [follow, pinned, lastKey, turns.length, virtualizer]);

  function onScroll() {
    const el = parentRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setPinned(distance < 80);
  }

  const activeIndex = React.useMemo(() => {
    if (activeMs === undefined) return -1;
    let idx = -1;
    for (let i = 0; i < turns.length; i++) if (turns[i]!.startMs <= activeMs) idx = i;
    return idx;
  }, [turns, activeMs]);

  return (
    <div className={cn("relative min-h-0", className)} data-testid="transcript">
      <div ref={parentRef} onScroll={onScroll} className="h-full overflow-y-auto overscroll-contain px-2 sm:px-4">
        {turns.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-[15px] text-muted">
            {emptyHint}
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${item.start}px)`,
                }}
              >
                <TurnRow turn={turns[item.index]!} onSeek={onSeek} active={item.index === activeIndex} />
              </div>
            ))}
          </div>
        )}
      </div>
      {follow && !pinned && turns.length > 0 ? (
        <Button
          size="sm"
          variant="secondary"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-pop"
          onClick={() => {
            setPinned(true);
            virtualizer.scrollToIndex(turns.length - 1, { align: "end" });
          }}
        >
          <ArrowDown /> Seguir la transcripción
        </Button>
      ) : null}
    </div>
  );
}
