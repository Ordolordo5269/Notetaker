"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, FileAudio, Upload, X } from "lucide-react";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect, FieldHint } from "@/components/ui/input";
import { Callout, Spinner } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api/client";
import { qk, useSubjects } from "@/lib/hooks/queries";
import type { ImportProgress, ImportResult } from "@/lib/import/audio-import";
import { IMPORT_PHASE_LABEL } from "@/lib/import/labels";
import { titleFromFileName } from "@/lib/import/plan";

interface Item {
  key: string;
  file: File;
  title: string;
  progress: ImportProgress | null;
  result: ImportResult | null;
  error: string | null;
}

interface ProfileOutlook {
  profile: { notesQuality: "max" | "economy" };
  outlook: { transcriptionPerHour: { turns: number }; notesTwoHours: { max: number; economy: number } };
  openaiConfigured: boolean;
}

function usd(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} $`;
}

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

const ACCEPT = "audio/*,.m4a,.mp3,.wav,.ogg,.oga,.opus,.webm,.aac,.flac,.caf,.3gp,.amr,.wma,.mp4";

export function ImportAudioDialog({
  open,
  onOpenChange,
  defaultSubjectId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultSubjectId?: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Importar audio"
        description="Sube grabaciones que ya tienes (notas de voz del iPhone, mp3, wav…). El audio se trocea en tu navegador sin perder calidad, se transcribe en el servidor y la clase queda como una grabada en directo."
        className="sm:max-w-xl"
      >
        <ImportForm defaultSubjectId={defaultSubjectId} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function ImportForm({
  defaultSubjectId,
  onOpenChange,
}: {
  defaultSubjectId?: string | null;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const subjects = useSubjects();
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => api<ProfileOutlook>("/api/profile") });
  const [subjectId, setSubjectId] = React.useState<string>(defaultSubjectId ?? "");
  const [thenNotes, setThenNotes] = React.useState(true);
  const [items, setItems] = React.useState<Item[]>([]);
  const [running, setRunning] = React.useState(false);
  const [finished, setFinished] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  // Leaving the page mid-upload would lose the chunks still in the browser.
  React.useEffect(() => {
    if (!running) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [running]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    // A FileList is live: copy it before the input is reset.
    const files = Array.from(list);
    setItems((prev) => {
      const known = new Set(prev.map((i) => `${i.file.name}:${i.file.size}`));
      const added: Item[] = [];
      for (const file of files) {
        const k = `${file.name}:${file.size}`;
        if (known.has(k)) continue;
        known.add(k);
        added.push({
          key: `${k}:${Date.now()}`,
          file,
          title: titleFromFileName(file.name),
          progress: null,
          result: null,
          error: null,
        });
      }
      return [...prev, ...added];
    });
  }

  function update(key: string, patch: Partial<Item>) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  async function run() {
    if (!items.length || running) return;
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const { importAudioFile, unloadFfmpeg } = await import("@/lib/import/audio-import");
    try {
      for (const item of items) {
        if (controller.signal.aborted) break;
        if (item.result) continue;
        try {
          const result = await importAudioFile({
            file: item.file,
            title: item.title.trim() || item.file.name,
            subjectId: subjectId || null,
            thenNotes,
            signal: controller.signal,
            onProgress: (progress) => update(item.key, { progress, error: null }),
          });
          update(item.key, { result, error: null });
        } catch (err) {
          update(item.key, { error: errorMessage(err), progress: null });
          if (controller.signal.aborted) break;
        }
      }
    } finally {
      unloadFfmpeg();
      abortRef.current = null;
      setRunning(false);
      setFinished(true);
      void qc.invalidateQueries({ queryKey: qk.dashboard });
      void qc.invalidateQueries({ queryKey: ["lectures"] });
    }
  }

  function cancel() {
    abortRef.current?.abort();
    // Terminating the converter is what actually interrupts a running ffmpeg command.
    void import("@/lib/import/audio-import").then(({ unloadFfmpeg }) => unloadFfmpeg());
    toast.message("Importación cancelada tras el archivo en curso");
  }

  const outlook = profile.data?.outlook;
  const quality = profile.data?.profile.notesQuality ?? "max";
  const pendingCount = items.filter((i) => !i.result).length;
  const okCount = items.filter((i) => i.result).length;

  return (
    <div className="space-y-4">
      {profile.data && !profile.data.openaiConfigured ? (
        <Callout tone="warning" icon={<AlertTriangle />}>
          El servidor no tiene configurada la clave de OpenAI: el audio se guardará, pero no se transcribirá hasta
          configurarla.
        </Callout>
      ) : null}
      <div>
        <Label htmlFor="import-subject">Asignatura</Label>
        <NativeSelect
          id="import-subject"
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
          disabled={subjects.isPending || running}
        >
          <option value="">Sin asignatura</option>
          {subjects.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
        <FieldHint>
          El vocabulario de la asignatura guía la transcripción, y los términos de esta clase se añadirán a él.
        </FieldHint>
      </div>

      <div>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          aria-label="Archivos de audio"
          data-testid="import-file-input"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {!finished ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => fileInput.current?.click()}
            disabled={running}
            className="w-full justify-center border-dashed"
          >
            <Upload /> {items.length ? "Añadir más archivos" : "Elegir archivos de audio"}
          </Button>
        ) : null}
        {items.length ? (
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border" aria-label="Archivos a importar">
            {items.map((item) => (
              <li key={item.key} className="px-3 py-3" data-testid="import-item">
                <div className="flex items-start gap-3">
                  <div className="mt-1 shrink-0 text-muted [&_svg]:size-4">
                    {item.result ? (
                      <Check className="text-success" />
                    ) : item.error ? (
                      <AlertTriangle className="text-danger" />
                    ) : (
                      <FileAudio />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    {running || item.result || item.error ? (
                      <p className="truncate text-sm font-medium">{item.title}</p>
                    ) : (
                      <Input
                        aria-label={`Título de ${item.file.name}`}
                        value={item.title}
                        maxLength={200}
                        onChange={(e) => update(item.key, { title: e.target.value })}
                      />
                    )}
                    <p className="mt-1 truncate text-[12.5px] text-subtle">
                      {item.file.name} · {formatBytes(item.file.size)}
                    </p>
                    {item.progress && !item.result ? (
                      <div className="mt-2" aria-live="polite">
                        <p className="text-[12.5px] text-muted">
                          {IMPORT_PHASE_LABEL[item.progress.phase]}
                          {item.progress.detail ? ` · ${item.progress.detail}` : ""}
                        </p>
                        <div
                          className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken"
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={
                            item.progress.ratio === null ? undefined : Math.round(item.progress.ratio * 100)
                          }
                          aria-label={IMPORT_PHASE_LABEL[item.progress.phase]}
                        >
                          <div
                            className={
                              item.progress.ratio === null
                                ? "h-full w-1/3 animate-pulse rounded-full bg-accent"
                                : "h-full rounded-full bg-accent transition-[width]"
                            }
                            style={
                              item.progress.ratio === null
                                ? undefined
                                : { width: `${Math.round(item.progress.ratio * 100)}%` }
                            }
                          />
                        </div>
                      </div>
                    ) : null}
                    {item.result ? (
                      <p className="mt-1.5 text-[12.5px] text-muted" data-testid="import-done">
                        {item.result.chunks} fragmentos subidos.{" "}
                        {item.result.jobId
                          ? thenNotes
                            ? "Se está transcribiendo; después se generarán los apuntes."
                            : "Se está transcribiendo."
                          : item.result.warning
                            ? `Audio guardado, pero la transcripción no pudo empezar: ${item.result.warning}`
                            : "Audio guardado."}{" "}
                        <Link
                          href={`/lectures/${item.result.lectureId}`}
                          className="font-medium text-accent underline-offset-2 hover:underline"
                        >
                          Abrir la clase
                        </Link>
                      </p>
                    ) : null}
                    {item.error ? (
                      <p className="mt-1.5 text-[12.5px] text-danger" role="alert">
                        {item.error}
                      </p>
                    ) : null}
                  </div>
                  {!running && !item.result ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Quitar ${item.file.name}`}
                      onClick={() => setItems((prev) => prev.filter((i) => i.key !== item.key))}
                    >
                      <X />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <label className="flex items-center justify-between gap-4 rounded-xl border border-border px-3 py-2.5">
        <span>
          <span className="block text-sm font-medium">Generar apuntes al terminar</span>
          <span className="block text-[12.5px] text-muted">
            Apuntes completos en cuanto acabe la transcripción, sin volver a entrar.
          </span>
        </span>
        <Switch
          checked={thenNotes}
          onCheckedChange={setThenNotes}
          disabled={running}
          aria-label="Generar apuntes al terminar"
        />
      </label>

      {outlook ? (
        <p className="text-[12.5px] leading-relaxed text-subtle">
          Coste orientativo: transcripción ≈ {usd(outlook.transcriptionPerHour.turns)} por hora de audio
          {thenNotes
            ? `; apuntes en calidad ${quality === "economy" ? "económica" : "máxima"} ≈ ${usd(outlook.notesTwoHours[quality])} por clase de dos horas`
            : ""}
          . Mantén esta pestaña abierta hasta que termine la subida; la transcripción continúa sola en el servidor.
        </p>
      ) : null}

      <DialogFooter>
        {running ? (
          <Button type="button" variant="secondary" onClick={cancel}>
            Cancelar
          </Button>
        ) : (
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {finished ? "Cerrar" : "Cancelar"}
          </Button>
        )}
        {!finished || pendingCount ? (
          <Button
            type="button"
            variant="primary"
            onClick={() => void run()}
            disabled={running || !pendingCount}
            data-testid="import-start"
          >
            {running ? <Spinner /> : <Upload />}
            {running ? "Importando…" : pendingCount > 1 ? `Importar ${pendingCount} archivos` : "Importar"}
          </Button>
        ) : null}
      </DialogFooter>
      {finished && okCount ? (
        <p className="sr-only" role="status">
          Importación terminada: {okCount} archivos subidos.
        </p>
      ) : null}
    </div>
  );
}
