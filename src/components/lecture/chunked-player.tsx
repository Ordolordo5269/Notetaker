"use client";
import * as React from "react";
import { AlertTriangle, Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatClock } from "@/lib/time";

export interface ChunkMeta {
  seq: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  overlapMs: number;
  partial: boolean;
}

export interface PlayerHandle {
  seek: (ms: number, autoplay?: boolean) => void;
}

const RATES = [1, 1.25, 1.5, 1.75, 2];

/**
 * Plays a lecture stored as consecutive audio files on one unified timeline.
 * Each chunk may start a little before the previous one ended (recorder
 * overlap); that duplicated head is skipped when chunks play back to back.
 */
export const ChunkedPlayer = React.forwardRef<
  PlayerHandle,
  { sessionId: string; chunks: ChunkMeta[]; totalMs: number; onTime?: (ms: number) => void; className?: string }
>(function ChunkedPlayer({ sessionId, chunks, totalMs, onTime, className }, ref) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [rate, setRate] = React.useState(1);
  const [currentMs, setCurrentMs] = React.useState(0);
  const [activeSeq, setActiveSeq] = React.useState<number | null>(chunks[0]?.seq ?? null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const pendingOffset = React.useRef<number | null>(null);
  const pendingPlay = React.useRef(false);
  const sorted = React.useMemo(() => [...chunks].sort((a, b) => a.seq - b.seq), [chunks]);
  const active = sorted.find((c) => c.seq === activeSeq) ?? null;
  const total = Math.max(totalMs, sorted.length ? sorted[sorted.length - 1]!.endMs : 0);

  const srcFor = React.useCallback((seq: number) => `/api/sessions/${sessionId}/chunks/${seq}/audio`, [sessionId]);

  const findChunk = React.useCallback(
    (ms: number) => {
      let found: ChunkMeta | null = null;
      for (const c of sorted) if (c.startMs <= ms && ms < c.endMs) found = c;
      if (found) return found;
      // Inside a gap: jump to the next chunk that starts after `ms`.
      return sorted.find((c) => c.startMs >= ms) ?? sorted[sorted.length - 1] ?? null;
    },
    [sorted],
  );

  const loadChunk = React.useCallback(
    (c: ChunkMeta, offsetMs: number, autoplay: boolean) => {
      const audio = audioRef.current;
      if (!audio) return;
      setError(null);
      pendingOffset.current = Math.max(0, offsetMs);
      pendingPlay.current = autoplay;
      if (activeSeq !== c.seq || !audio.src.endsWith(srcFor(c.seq))) {
        setLoading(true);
        setActiveSeq(c.seq);
        audio.src = srcFor(c.seq);
        audio.load();
      } else {
        audio.currentTime = pendingOffset.current / 1000;
        pendingOffset.current = null;
        if (autoplay) void audio.play().catch(() => setPlaying(false));
      }
      setCurrentMs(c.startMs + offsetMs);
    },
    [activeSeq, srcFor],
  );

  const seek = React.useCallback(
    (ms: number, autoplay?: boolean) => {
      const target = Math.min(Math.max(0, ms), total);
      const c = findChunk(target);
      if (!c) return;
      loadChunk(c, Math.max(0, target - c.startMs), autoplay ?? playing);
    },
    [findChunk, loadChunk, playing, total],
  );

  React.useImperativeHandle(ref, () => ({ seek }), [seek]);

  function playNext(after: ChunkMeta) {
    const idx = sorted.findIndex((c) => c.seq === after.seq);
    const next = sorted[idx + 1];
    if (!next) {
      setPlaying(false);
      return;
    }
    loadChunk(next, next.overlapMs, true);
  }

  // Audio element event wiring.
  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onLoaded = () => {
      setLoading(false);
      if (pendingOffset.current !== null) {
        audio.currentTime = pendingOffset.current / 1000;
        pendingOffset.current = null;
      }
      audio.playbackRate = rate;
      if (pendingPlay.current) void audio.play().catch(() => setPlaying(false));
    };
    const onTimeUpdate = () => {
      if (!active) return;
      const ms = active.startMs + audio.currentTime * 1000;
      setCurrentMs(ms);
      onTime?.(ms);
    };
    const onEnded = () => {
      if (active) playNext(active);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onError = () => {
      setLoading(false);
      setError("No se pudo reproducir este fragmento de audio.");
      setPlaying(false);
    };
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("error", onError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers read the latest active chunk via closure per render
  }, [active, rate, onTime, sorted]);

  React.useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate]);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      return;
    }
    if (!active || !audio.src) {
      const first = sorted[0];
      if (first) loadChunk(first, 0, true);
      return;
    }
    void audio.play().catch(() => setPlaying(false));
  }

  if (!sorted.length) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl border border-dashed border-border-strong px-4 py-3 text-sm text-muted",
          className,
        )}
      >
        <AlertTriangle className="size-4" /> Esta clase no tiene audio almacenado.
      </div>
    );
  }

  const progress = total > 0 ? Math.min(1, currentMs / total) : 0;

  return (
    <div className={cn("rounded-xl border border-border bg-surface px-3 py-2.5 shadow-soft", className)}>
      <audio ref={audioRef} preload="metadata" />
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Retroceder 15 segundos"
          onClick={() => seek(currentMs - 15_000)}
        >
          <RotateCcw />
        </Button>
        <Button
          variant="primary"
          size="icon"
          aria-label={playing ? "Pausar" : "Reproducir"}
          onClick={toggle}
          className="rounded-full"
        >
          {playing ? <Pause /> : <Play className="translate-x-px" />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Avanzar 15 segundos"
          onClick={() => seek(currentMs + 15_000)}
        >
          <RotateCw />
        </Button>
        <span className="ml-1 hidden w-[4.5rem] text-right font-mono text-[12px] tabular-nums text-muted sm:inline">
          {formatClock(currentMs)}
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.round(total))}
          step={250}
          value={Math.round(currentMs)}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Posición en la grabación"
          className="mx-1 h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-border [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent"
          style={{
            background: `linear-gradient(to right, var(--accent) ${progress * 100}%, var(--border) ${progress * 100}%)`,
          }}
        />
        <span className="hidden w-[4.5rem] font-mono text-[12px] tabular-nums text-muted sm:inline">
          {formatClock(total)}
        </span>
        <select
          aria-label="Velocidad"
          value={rate}
          onChange={(e) => setRate(Number(e.target.value))}
          className="hidden h-7 rounded-md border border-border bg-surface px-1.5 font-mono text-[12px] text-muted sm:block"
        >
          {RATES.map((r) => (
            <option key={r} value={r}>
              {r}×
            </option>
          ))}
        </select>
      </div>
      {/* Phone width: times and speed get their own row so the slider keeps its space. */}
      <div className="mt-1.5 flex items-center justify-between px-1 font-mono text-[11.5px] tabular-nums text-muted sm:hidden">
        <span>{formatClock(currentMs)}</span>
        <select
          aria-label="Velocidad"
          value={rate}
          onChange={(e) => setRate(Number(e.target.value))}
          className="h-6 rounded-md border border-border bg-surface px-1 font-mono text-[11.5px] text-muted"
        >
          {RATES.map((r) => (
            <option key={r} value={r}>
              {r}×
            </option>
          ))}
        </select>
        <span>{formatClock(total)}</span>
      </div>
      {error || loading || active?.partial ? (
        <p className={cn("mt-1.5 px-1 text-[12px]", error ? "text-danger" : "text-muted")}>
          {error ??
            (loading
              ? "Cargando audio…"
              : "Este fragmento se recuperó de una grabación interrumpida y puede estar incompleto.")}
        </p>
      ) : null}
    </div>
  );
});
