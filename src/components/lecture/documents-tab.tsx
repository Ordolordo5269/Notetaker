"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Download, FileText, MessageSquare, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Callout, EmptyState, Skeleton, Spinner } from "@/components/ui/misc";
import { api, errorMessage, parseApiError } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import type { AttachmentView } from "@/lib/data/attachments";
import { UNIT_LABEL } from "@/lib/documents/labels";
import { formatDateTime } from "@/lib/time";

const STATUS: Record<
  AttachmentView["extractionStatus"],
  { label: string; tone: "neutral" | "accent" | "warning" | "danger" }
> = {
  pending: { label: "En cola", tone: "neutral" },
  processing: { label: "Leyendo", tone: "neutral" },
  ready: { label: "Texto extraído", tone: "accent" },
  needs_ocr: { label: "Sin texto legible", tone: "warning" },
  failed: { label: "Error", tone: "danger" },
};

export function useAttachments(sessionId: string) {
  return useQuery({
    queryKey: ["attachments", sessionId],
    queryFn: async () =>
      (await api<{ attachments: AttachmentView[] }>(`/api/sessions/${sessionId}/attachments`)).attachments,
    refetchInterval: (q) =>
      q.state.data?.some((a) => a.extractionStatus === "pending" || a.extractionStatus === "processing") ? 2500 : false,
  });
}

function formatBytes(n: number): string {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

export function DocumentsTab({
  sessionId,
  focus,
  onAskAboutPage,
}: {
  sessionId: string;
  /** Page to open (from a chat citation). */
  focus: { attachmentId: string; page: number } | null;
  onAskAboutPage: (question: string) => void;
}) {
  const qc = useQueryClient();
  const attachments = useAttachments(sessionId);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const activeId = focus?.attachmentId ?? selected ?? attachments.data?.[0]?.id ?? null;
  const active = attachments.data?.find((a) => a.id === activeId) ?? null;
  const pages = useQuery({
    queryKey: ["attachment-pages", activeId],
    queryFn: async () =>
      (await api<{ pages: { page: number; text: string }[] }>(`/api/attachments/${activeId}/pages`)).pages,
    enabled: Boolean(activeId) && active?.extractionStatus === "ready",
  });

  React.useEffect(() => {
    if (focus) {
      const el = document.getElementById(`page-${focus.attachmentId}-${focus.page}`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [focus, pages.data]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.set("file", file);
        const res = await fetch(`/api/sessions/${sessionId}/attachments`, {
          method: "POST",
          body: form,
          credentials: "same-origin",
        });
        if (!res.ok) throw await parseApiError(res);
      }
      toast.success(files.length === 1 ? "Documento subido. Extrayendo texto…" : `${files.length} documentos subidos.`);
      void qc.invalidateQueries({ queryKey: ["attachments", sessionId] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/attachments/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setSelected(null);
      void qc.invalidateQueries({ queryKey: ["attachments", sessionId] });
      toast.success("Documento eliminado");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const list = attachments.data ?? [];
  return (
    <div className="space-y-6">
      <div
        className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-strong px-6 py-8 text-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void upload(e.dataTransfer.files);
        }}
      >
        <Upload className="mb-2 size-5 text-subtle" />
        <p className="text-[15px] font-medium">Diapositivas y documentos del profesor</p>
        <p className="mt-1 max-w-md text-sm text-muted">
          PDF, DOCX o PPTX de hasta 25 MB. El texto se extrae por página para que los apuntes y el chat puedan citarlas.
          Los PDF escaneados sin texto se adjuntan, pero la IA no puede leerlos.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.pptx"
          multiple
          className="sr-only"
          id="attachment-input"
          aria-label="Elegir archivos"
          onChange={(e) => void upload(e.target.files)}
        />
        <Button variant="primary" className="mt-4" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? <Spinner /> : <Upload />}
          {uploading ? "Subiendo…" : "Elegir archivos"}
        </Button>
      </div>

      {attachments.isPending ? (
        <Skeleton className="h-20" />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title="Sin documentos adjuntos"
          description="Cuando subas las diapositivas, podrás preguntar «¿Qué explicó el profesor sobre la diapositiva 12?»."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <ul className="space-y-2">
            {list.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setSelected(a.id)}
                  className={cn(
                    "w-full rounded-xl border bg-surface p-3 text-left shadow-soft transition hover:border-border-strong",
                    activeId === a.id ? "border-accent" : "border-border",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="size-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{a.fileName}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-muted">
                    <Badge tone={STATUS[a.extractionStatus].tone}>
                      {(a.extractionStatus === "pending" || a.extractionStatus === "processing") && (
                        <Spinner className="size-3" />
                      )}
                      {STATUS[a.extractionStatus].label}
                    </Badge>
                    <span>{a.kind.toUpperCase()}</span>
                    <span>{formatBytes(a.sizeBytes)}</span>
                    {a.pageCount ? (
                      <span>
                        {a.pageCount} {UNIT_LABEL[a.kind]}
                        {a.pageCount === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="min-w-0">
            {active ? (
              <div className="rounded-2xl border border-border bg-surface shadow-soft">
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium">{active.fileName}</p>
                    <p className="text-[12px] text-muted">Subido {formatDateTime(active.createdAt)}</p>
                  </div>
                  <Button variant="secondary" size="sm" asChild>
                    <a href={`/api/attachments/${active.id}/file?download=1`}>
                      <Download /> Descargar
                    </a>
                  </Button>
                  <Button
                    variant="danger-ghost"
                    size="sm"
                    onClick={() => remove.mutate(active.id)}
                    disabled={remove.isPending}
                  >
                    <Trash2 /> Eliminar
                  </Button>
                </div>
                <div className="max-h-[70dvh] overflow-y-auto p-4">
                  {active.extractionStatus === "needs_ocr" || active.extractionStatus === "failed" ? (
                    <Callout
                      tone={active.extractionStatus === "failed" ? "danger" : "warning"}
                      icon={<AlertTriangle />}
                    >
                      {active.extractionError ?? "No se pudo extraer texto."}
                    </Callout>
                  ) : active.extractionStatus !== "ready" ? (
                    <p className="inline-flex items-center gap-2 text-sm text-muted">
                      <Spinner /> Extrayendo texto…
                    </p>
                  ) : pages.isPending ? (
                    <Skeleton className="h-32" />
                  ) : (
                    <ol className="space-y-4">
                      {pages.data?.map((p) => (
                        <li
                          key={p.page}
                          id={`page-${active.id}-${p.page}`}
                          className={cn(
                            "rounded-xl border border-border p-4 scroll-mt-4",
                            focus?.attachmentId === active.id &&
                              focus.page === p.page &&
                              "border-accent bg-accent-soft/30",
                          )}
                        >
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-[12px] font-medium uppercase tracking-[0.05em] text-subtle">
                              {UNIT_LABEL[active.kind]} {p.page}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                onAskAboutPage(
                                  `¿Qué explicó el profesor sobre la ${UNIT_LABEL[active.kind]} ${p.page} de "${active.fileName}"?`,
                                )
                              }
                            >
                              <MessageSquare /> Preguntar
                            </Button>
                          </div>
                          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-foreground/90">{p.text}</p>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
