"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bookmark,
  Check,
  ChevronDown,
  CloudOff,
  CloudUpload,
  HelpCircle,
  Mic,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Square,
  Star,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, ConfirmDialog } from "@/components/ui/dialog";
import { Label, Textarea, NativeSelect } from "@/components/ui/input";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui/menu";
import { Badge, Callout, Spinner } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import { SubjectDot } from "@/components/app/subject-dot";
import { cn } from "@/lib/cn";
import { listMicrophones, type MicDevice } from "@/lib/audio/capture";
import type { MarkerType } from "@/lib/db/schema";
import type { SessionState, TranscriptionStatus } from "@/lib/recording/session-controller";
import { formatClock, formatDuration } from "@/lib/time";
import { LevelMeter } from "./level-meter";
import { TranscriptView } from "./transcript-view";
import { useClock, useSessionController, useSessionState } from "./use-session-controller";

const MARKER_META: Record<MarkerType, { label: string; icon: React.ReactNode; short: string }> = {
  important: { label: "Importante", short: "Importante", icon: <Star /> },
  exam: { label: "Posible examen", short: "Examen", icon: <Bookmark /> },
  confused: { label: "No lo he entendido", short: "No entendido", icon: <HelpCircle /> },
  note: { label: "Nota breve", short: "Nota", icon: <Pencil /> },
};

function transcriptionLabel(
  t: SessionState["transcription"],
  online: boolean,
): { text: string; tone: "accent" | "neutral" | "warning" | "danger"; pulse?: boolean } {
  if (!online) return { text: "Sin conexión: transcripción en espera", tone: "warning" };
  const map: Record<
    TranscriptionStatus,
    { text: string; tone: "accent" | "neutral" | "warning" | "danger"; pulse?: boolean }
  > = {
    off: { text: "Transcripción desactivada", tone: "neutral" },
    connecting: { text: "Conectando transcripción…", tone: "neutral", pulse: true },
    live: { text: "Transcripción en directo", tone: "accent" },
    reconnecting: { text: "Reconectando transcripción", tone: "warning", pulse: true },
    fallback: { text: "Transcripción por turnos", tone: "neutral" },
    failed: { text: "Transcripción no disponible", tone: "danger" },
    paused: { text: "Transcripción en pausa", tone: "neutral" },
  };
  return map[t.status];
}

export function RecordingScreen({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const controller = useSessionController(sessionId);
  const state = useSessionState(controller);
  const clock = useClock(controller);
  const [noteOpen, setNoteOpen] = React.useState(false);
  const [finishOpen, setFinishOpen] = React.useState(false);
  const [mics, setMics] = React.useState<MicDevice[]>([]);

  const phase = state?.phase;
  const missingCount = state?.missingChunks?.length ?? 0;
  const micLabel = state?.micLabel;

  React.useEffect(() => {
    if (phase === "finished" && missingCount === 0) {
      const t = setTimeout(() => router.replace(`/lectures/${sessionId}`), 600);
      return () => clearTimeout(t);
    }
  }, [phase, missingCount, router, sessionId]);

  React.useEffect(() => {
    if (phase === "recording" || phase === "paused") void listMicrophones().then(setMics);
  }, [phase, micLabel]);

  // Keyboard shortcuts while recording: Space pause/resume, 1/2/3 markers.
  React.useEffect(() => {
    if (!controller) return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (phase !== "recording" && phase !== "paused") return;
      if (e.key === " ") {
        e.preventDefault();
        void (phase === "recording" ? controller!.pause() : controller!.resume());
      } else if (phase === "recording" && (e.key === "1" || e.key === "2" || e.key === "3")) {
        void controller!.addMarker(e.key === "1" ? "important" : e.key === "2" ? "exam" : "confused");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controller, phase]);

  if (!controller || !state || state.phase === "loading") {
    return (
      <div className="flex h-[calc(100dvh-3.5rem)] items-center justify-center text-muted lg:h-dvh">
        <Spinner className="mr-2" /> Preparando la sesión…
      </div>
    );
  }
  const s = state;
  const pendingTotal = s.sync.pendingChunks + s.sync.pendingTurns + s.sync.pendingSegments + s.sync.pendingMarkers;
  const tl = transcriptionLabel(s.transcription, s.online);

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col lg:h-dvh">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-border px-4 py-2.5 sm:px-6">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-[12.5px] text-muted">
            <SubjectDot color={s.lecture?.subjectColor} />
            {s.lecture?.subjectName ?? "Sin asignatura"}
          </p>
          <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em]">{s.lecture?.title ?? "…"}</h1>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          {s.phase === "recording" || s.phase === "paused" ? (
            <Badge tone={s.phase === "recording" ? "danger" : "neutral"} className="h-6 px-2 text-[12px]">
              {s.phase === "recording" ? (
                <span className="size-1.5 animate-pulse-dot rounded-full bg-recording" />
              ) : (
                <Pause />
              )}
              {s.phase === "recording" ? "Grabando" : "En pausa"}
            </Badge>
          ) : null}
          <span className="font-mono text-[15px] tabular-nums tracking-tight sm:text-[17px]" aria-live="off">
            {formatClock(clock.timelineMs, { forceHours: clock.timelineMs >= 3_600_000 })}
          </span>
        </div>
      </header>

      {/* Status strip */}
      {s.phase === "recording" || s.phase === "paused" || s.phase === "finalizing" ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-sunken/60 px-4 py-1.5 text-[12.5px] sm:px-6">
          <span
            className={cn(
              "inline-flex items-center gap-1.5",
              tl.tone === "accent" && "text-accent",
              tl.tone === "warning" && "text-warning",
              tl.tone === "danger" && "text-danger",
              tl.tone === "neutral" && "text-muted",
            )}
          >
            <span className={cn("size-1.5 rounded-full bg-current", tl.pulse && "animate-pulse-dot")} />
            {tl.text}
            {s.transcription.mode === "turns" && s.phase === "recording" ? (
              <Tooltip content="La conexión en directo no está disponible. Cada intervención se transcribe al terminar, con unos segundos de retraso.">
                <HelpCircle className="size-3.5" />
              </Tooltip>
            ) : null}
          </span>
          <span className="inline-flex items-center gap-1.5 text-muted">
            {s.online ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5 text-warning" />}
            {s.online ? "Conectado" : "Sin conexión"}
          </span>
          <span className={cn("inline-flex items-center gap-1.5", pendingTotal > 0 ? "text-muted" : "text-accent")}>
            {s.sync.uploading ? (
              <Spinner className="size-3.5" />
            ) : pendingTotal > 0 ? (
              <CloudOff className="size-3.5" />
            ) : (
              <Check className="size-3.5" />
            )}
            {pendingTotal === 0
              ? "Grabación guardada"
              : s.sync.pendingChunks > 0
                ? `${s.sync.pendingChunks} ${s.sync.pendingChunks === 1 ? "fragmento pendiente" : "fragmentos pendientes"} de sincronizar`
                : `${pendingTotal} ${pendingTotal === 1 ? "elemento pendiente" : "elementos pendientes"}`}
          </span>
          {s.micLost ? (
            <span className="inline-flex items-center gap-1.5 text-danger">
              <AlertTriangle className="size-3.5" /> Micrófono desconectado
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Notices */}
      {s.notices.length ? (
        <div className="space-y-1.5 px-4 pt-2 sm:px-6">
          {s.notices.slice(-2).map((n) => (
            <Callout
              key={n.id}
              tone={n.tone}
              className="py-2"
              action={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Cerrar aviso"
                  onClick={() => controller.dismissNotice(n.id)}
                >
                  <X />
                </Button>
              }
            >
              {n.text}
            </Callout>
          ))}
        </div>
      ) : null}

      {/* Body */}
      <div className="min-h-0 flex-1">
        {s.phase === "idle" || s.phase === "starting" ? (
          <StartPanel state={s} onStart={(d) => controller.start(d)} />
        ) : s.phase === "recovery" ? (
          <RecoveryPanel state={s} onContinue={() => controller.start()} onFinish={() => controller.finalize()} />
        ) : s.phase === "error" ? (
          <div className="mx-auto max-w-md px-6 py-16">
            <Callout tone="danger" title="No se pudo abrir la sesión">
              {s.error}
            </Callout>
            <Button className="mt-4" variant="secondary" onClick={() => router.replace("/")}>
              Volver al inicio
            </Button>
          </div>
        ) : s.phase === "finalizing" || s.phase === "finished" ? (
          <FinalizePanel state={s} onRetry={(accept) => controller.retryFinalize(accept)} sessionId={sessionId} />
        ) : (
          <div className="mx-auto flex h-full max-w-3xl flex-col">
            <TranscriptView
              turns={s.turns}
              follow
              className="flex-1"
              emptyHint={
                s.micLost ? (
                  "La grabación está detenida: reconecta el micrófono para continuar."
                ) : (
                  <span>
                    Cuando el profesor empiece a hablar, el texto aparecerá aquí en el idioma en que se pronuncie.
                    <br />
                    <span className="text-[13px] text-subtle">
                      Español e inglés se reconocen automáticamente, sin traducir.
                    </span>
                  </span>
                )
              }
            />
            {s.markers.length ? (
              <div className="flex flex-wrap gap-1.5 px-4 pb-2 pt-1 sm:px-6">
                {s.markers.slice(-6).map((m) => (
                  <Badge
                    key={m.id}
                    tone={m.type === "exam" ? "accent" : m.type === "confused" ? "warning" : "neutral"}
                    className="h-6 gap-1 pl-1.5 pr-1 text-[11.5px]"
                  >
                    {MARKER_META[m.type].icon}
                    {formatClock(m.atMs)}
                    {m.note ? <span className="max-w-32 truncate font-normal">· {m.note}</span> : null}
                    <button
                      type="button"
                      aria-label="Quitar marcador"
                      className="ml-0.5 rounded p-0.5 hover:bg-foreground/10"
                      onClick={() => controller.removeMarker(m.id)}
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Controls */}
      {s.phase === "recording" || s.phase === "paused" ? (
        <footer className="border-t border-border bg-background px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            {s.micLost ? (
              <Callout
                tone="danger"
                icon={<AlertTriangle />}
                title="Micrófono desconectado"
                action={
                  <Button variant="primary" size="sm" onClick={() => controller.reconnectMicrophone()}>
                    Reconectar
                  </Button>
                }
              >
                No se está grabando audio. El texto y el audio anteriores están a salvo.
              </Callout>
            ) : null}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(["important", "exam", "confused"] as const).map((type) => (
                <Button
                  key={type}
                  variant="secondary"
                  size="lg"
                  className="justify-start gap-2 sm:justify-center"
                  disabled={s.phase !== "recording"}
                  onClick={() => controller.addMarker(type)}
                >
                  {MARKER_META[type].icon}
                  <span className="truncate">{MARKER_META[type].label}</span>
                </Button>
              ))}
              <Button
                variant="secondary"
                size="lg"
                className="justify-start gap-2 sm:justify-center"
                disabled={s.phase !== "recording"}
                onClick={() => setNoteOpen(true)}
              >
                <Pencil /> Nota breve
              </Button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <LevelMeter level={clock.level} speaking={clock.speaking} lost={s.micLost} />
                <MicMenu
                  mics={mics}
                  current={s.micDeviceId}
                  label={s.micLabel}
                  onPick={(id) => controller.switchMicrophone(id)}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 sm:ml-auto sm:flex">
                {s.phase === "recording" ? (
                  <Button size="xl" variant="secondary" onClick={() => controller.pause()} className="sm:min-w-32">
                    <Pause /> Pausar
                  </Button>
                ) : (
                  <Button size="xl" variant="primary" onClick={() => controller.resume()} className="sm:min-w-32">
                    <Play /> Reanudar
                  </Button>
                )}
                <Button size="xl" variant="danger" onClick={() => setFinishOpen(true)} className="sm:min-w-32">
                  <Square /> Finalizar
                </Button>
              </div>
            </div>
          </div>
        </footer>
      ) : null}

      <NoteDialog open={noteOpen} onOpenChange={setNoteOpen} onSave={(note) => controller.addMarker("note", note)} />
      <ConfirmDialog
        open={finishOpen}
        onOpenChange={setFinishOpen}
        title="¿Finalizar la clase?"
        description={
          <>
            Se cerrará la grabación ({formatDuration(clock.timelineMs)}) y se comprobará que todo el audio está
            sincronizado
            {pendingTotal > 0 ? ` (quedan ${pendingTotal} elementos por subir; se subirán antes de cerrar)` : ""}.
            Después podrás generar los apuntes.
          </>
        }
        confirmLabel="Finalizar clase"
        onConfirm={() => {
          setFinishOpen(false);
          void controller.finalize();
        }}
      />
    </div>
  );
}

function MicMenu({
  mics,
  current,
  label,
  onPick,
}: {
  mics: MicDevice[];
  current: string | null;
  label: string;
  onPick: (id: string) => void;
}) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="sm" className="max-w-48 text-muted">
          <Mic />
          <span className="truncate">{label || "Micrófono"}</span>
          <ChevronDown />
        </Button>
      </MenuTrigger>
      <MenuContent align="start" className="max-w-80">
        <MenuLabel>Micrófono</MenuLabel>
        {mics.length === 0 ? <MenuItem disabled>Sin lista de dispositivos</MenuItem> : null}
        {mics.map((m) => (
          <MenuItem key={m.deviceId} onSelect={() => onPick(m.deviceId)}>
            {m.deviceId === current ? <Check /> : <span className="size-4" />}
            <span className="truncate">{m.label}</span>
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

function NoteDialog({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSave: (note: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Nota breve" description="Se guardará asociada a este momento de la clase.">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const note = String(new FormData(e.currentTarget).get("note") ?? "").trim();
            if (note) onSave(note);
            onOpenChange(false);
          }}
        >
          <Label htmlFor="marker-note">Nota</Label>
          <Textarea
            id="marker-note"
            name="note"
            autoFocus
            rows={3}
            maxLength={2000}
            placeholder="Repasar la diferencia con el art. 25"
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary">
              Guardar nota
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StartPanel({ state, onStart }: { state: SessionState; onStart: (deviceId: string | null) => void }) {
  const [mics, setMics] = React.useState<MicDevice[]>([]);
  const [deviceId, setDeviceId] = React.useState<string>("");
  React.useEffect(() => {
    void listMicrophones().then(setMics);
  }, [state.micPermissionDenied]);
  const starting = state.phase === "starting";
  return (
    <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="mb-6 flex size-20 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Mic className="size-8" />
      </div>
      <h2 className="text-[22px] font-semibold tracking-[-0.015em]">Lista para grabar</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        Coloca el portátil orientado hacia el profesor. La transcripción escribe en el idioma hablado, español o inglés,
        sin traducir.
      </p>
      {mics.length > 1 ? (
        <div className="mt-6 w-full text-left">
          <Label htmlFor="start-mic">Micrófono</Label>
          <NativeSelect id="start-mic" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            <option value="">Predeterminado del sistema</option>
            {mics.map((m) => (
              <option key={m.deviceId} value={m.deviceId}>
                {m.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}
      {state.error ? (
        <Callout
          tone="danger"
          className="mt-5 w-full text-left"
          title={state.micPermissionDenied ? "Permiso de micrófono denegado" : undefined}
        >
          {state.error}
          {state.micPermissionDenied
            ? " En Safari: Safari › Ajustes para este sitio › Micrófono › Permitir. En Chrome: icono del candado › Micrófono."
            : ""}
        </Callout>
      ) : null}
      {state.storage?.low ? (
        <Callout tone="warning" className="mt-4 w-full text-left">
          Queda poco almacenamiento en este dispositivo. Libera espacio para asegurar la copia local del audio.
        </Callout>
      ) : null}
      <Button
        size="xl"
        variant="primary"
        className="mt-8 w-full"
        disabled={starting}
        onClick={() => onStart(deviceId || null)}
      >
        {starting ? <Spinner /> : <Mic />}
        {starting ? "Comprobando micrófono…" : "Iniciar grabación"}
      </Button>
      <p className="mt-4 text-[12px] leading-relaxed text-subtle">
        Atajos: <kbd className="rounded border border-border px-1 font-mono">espacio</kbd> pausa,{" "}
        <kbd className="rounded border border-border px-1 font-mono">1</kbd> importante,{" "}
        <kbd className="rounded border border-border px-1 font-mono">2</kbd> examen,{" "}
        <kbd className="rounded border border-border px-1 font-mono">3</kbd> no entendido.
      </p>
    </div>
  );
}

function RecoveryPanel({
  state,
  onContinue,
  onFinish,
}: {
  state: SessionState;
  onContinue: () => void;
  onFinish: () => void;
}) {
  const r = state.recovery;
  if (!r) return null;
  const pending =
    state.sync.pendingChunks + state.sync.pendingTurns + state.sync.pendingSegments + state.sync.pendingMarkers;
  return (
    <div className="mx-auto max-w-lg px-6 py-12">
      <div className="mb-5 flex size-12 items-center justify-center rounded-full bg-warning-soft text-warning">
        <RotateCcw className="size-5" />
      </div>
      <h2 className="text-[22px] font-semibold tracking-[-0.015em]">Sesión interrumpida</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        Esta clase se quedó abierta. Esto es lo que se conserva en este dispositivo y en el servidor:
      </p>
      <dl className="mt-5 divide-y divide-border rounded-xl border border-border bg-surface text-sm">
        <Row k="Tiempo grabado" v={formatDuration(r.lastTimelineMs)} />
        <Row k="Fragmentos de audio locales" v={String(r.localChunks)} />
        <Row
          k="Pendientes de subir"
          v={
            pending === 0
              ? "Ninguno"
              : `${state.sync.pendingChunks} de audio · ${state.sync.pendingTurns} de transcripción`
          }
        />
        {r.recoveredPartialChunks > 0 ? (
          <Row k="Recuperados de una grabación cortada" v={`${r.recoveredPartialChunks} (pueden estar incompletos)`} />
        ) : null}
        <Row k="Transcripción" v={`${state.turns.filter((t) => t.state === "final").length} fragmentos`} />
      </dl>
      <Callout tone="warning" className="mt-4" icon={<AlertTriangle />}>
        El audio entre la interrupción y ahora no se grabó. Si continúas, se anotará ese salto en la transcripción.
        {!state.online ? " Ahora mismo no hay conexión: lo pendiente se subirá cuando vuelva." : ""}
      </Callout>
      {state.error ? (
        <Callout tone="danger" className="mt-3">
          {state.error}
        </Callout>
      ) : null}
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Button size="lg" variant="primary" className="flex-1" onClick={onContinue}>
          <Mic /> Continuar grabando
        </Button>
        <Button size="lg" variant="secondary" className="flex-1" onClick={onFinish}>
          <Square /> Finalizar con lo guardado
        </Button>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}

function FinalizePanel({
  state,
  onRetry,
  sessionId,
}: {
  state: SessionState;
  onRetry: (acceptMissing: boolean) => void;
  sessionId: string;
}) {
  const pending =
    state.sync.pendingChunks + state.sync.pendingTurns + state.sync.pendingSegments + state.sync.pendingMarkers;
  const [confirmSkip, setConfirmSkip] = React.useState(false);
  if (state.phase === "finished") {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Check className="size-6" />
        </div>
        <h2 className="text-[22px] font-semibold tracking-[-0.015em]">Clase guardada</h2>
        {state.missingChunks?.length ? (
          <Callout tone="warning" className="mt-4 text-left">
            Se cerró sin {state.missingChunks.length} fragmentos de audio que no pudieron subirse. La transcripción de
            esos tramos puede faltar.
          </Callout>
        ) : (
          <p className="mt-2 text-muted">Audio y transcripción sincronizados. Abriendo la clase…</p>
        )}
        <Button className="mt-6" variant="primary" asChild>
          <Link href={`/lectures/${sessionId}`}>Abrir la clase</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-md px-6 py-16 text-center">
      <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-sunken text-muted">
        {state.sync.uploading ? <Spinner className="size-6" /> : <CloudUpload className="size-6" />}
      </div>
      <h2 className="text-[22px] font-semibold tracking-[-0.015em]">Cerrando la clase</h2>
      <p className="mt-2 text-[15px] text-muted">
        {pending > 0
          ? `Subiendo ${pending} ${pending === 1 ? "elemento pendiente" : "elementos pendientes"}… No cierres esta pestaña.`
          : "Comprobando que el servidor tiene todo el audio…"}
      </p>
      {state.error ? (
        <Callout
          tone={state.online ? "danger" : "warning"}
          className="mt-5 text-left"
          icon={state.online ? <AlertTriangle /> : <WifiOff />}
        >
          {state.error}
        </Callout>
      ) : null}
      {state.error ? (
        <div className="mt-5 flex flex-col gap-2">
          <Button variant="primary" onClick={() => onRetry(false)}>
            <RotateCcw /> Reintentar
          </Button>
          <Button variant="ghost" className="text-muted" onClick={() => setConfirmSkip(true)}>
            Finalizar sin los fragmentos pendientes
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmSkip}
        onOpenChange={setConfirmSkip}
        title="¿Finalizar sin todo el audio?"
        description="Los fragmentos que no se subieron seguirán en este navegador hasta que borres sus datos, pero la clase quedará cerrada sin ellos y no se podrán transcribir después desde el servidor."
        confirmLabel="Finalizar de todos modos"
        destructive
        onConfirm={() => {
          setConfirmSkip(false);
          onRetry(true);
        }}
      />
    </div>
  );
}
