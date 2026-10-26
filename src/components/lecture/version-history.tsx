"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, EyeOff, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge, Skeleton } from "@/components/ui/misc";
import { api, errorMessage } from "@/lib/api/client";
import type { VersionOrigin } from "@/lib/db/schema";
import { qk } from "@/lib/hooks/queries";
import type { StudyDocumentContent } from "@/lib/notes/types";
import { formatDateTime } from "@/lib/time";
import { DocumentView } from "./document-view";

interface VersionRow {
  id: string;
  versionNumber: number;
  origin: VersionOrigin;
  wordCount: number;
  label: string | null;
  createdAt: number;
}

const ORIGIN_LABEL: Record<VersionOrigin, string> = {
  ai: "Generada por la IA",
  ai_section: "Sección regenerada",
  user: "Edición manual",
  restore: "Restaurada",
};

export function VersionHistoryDialog({
  open,
  onOpenChange,
  documentId,
  sessionId,
  currentVersionId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  documentId: string;
  sessionId: string;
  currentVersionId: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Historial de versiones"
        description="Cada generación, edición o restauración crea una versión nueva. Nada se sobrescribe."
        className="max-w-2xl"
      >
        {open ? (
          <VersionList documentId={documentId} sessionId={sessionId} currentVersionId={currentVersionId} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function VersionList({
  documentId,
  sessionId,
  currentVersionId,
}: {
  documentId: string;
  sessionId: string;
  currentVersionId: string | null;
}) {
  const qc = useQueryClient();
  const [previewId, setPreviewId] = React.useState<string | null>(null);
  const versions = useQuery({
    queryKey: ["versions", documentId],
    queryFn: async () => (await api<{ versions: VersionRow[] }>(`/api/documents/${documentId}/versions`)).versions,
  });
  const preview = useQuery({
    queryKey: ["version", documentId, previewId],
    queryFn: async () =>
      (await api<{ version: { content: StudyDocumentContent } }>(`/api/documents/${documentId}/versions/${previewId}`))
        .version.content,
    enabled: Boolean(previewId),
  });
  const restore = useMutation({
    mutationFn: (versionId: string) =>
      api<{ versionNumber: number; unchanged: boolean }>(`/api/documents/${documentId}/restore`, {
        body: { versionId },
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: qk.documents(sessionId) });
      void qc.invalidateQueries({ queryKey: ["versions", documentId] });
      toast.success(r.unchanged ? "Esa versión ya era la actual." : `Restaurada como versión ${r.versionNumber}.`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (versions.isPending) return <Skeleton className="h-24" />;
  return (
    <div className="space-y-4">
      <ol className="divide-y divide-border rounded-xl border border-border" data-testid="version-list">
        {versions.data?.map((v) => {
          const isCurrent = v.id === currentVersionId;
          return (
            <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
              <span className="w-10 font-mono text-[12.5px] text-muted">v{v.versionNumber}</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{v.label ?? ORIGIN_LABEL[v.origin]}</span>
                <span className="block text-[12px] text-muted">
                  {ORIGIN_LABEL[v.origin]} · {formatDateTime(v.createdAt)} · {v.wordCount.toLocaleString("es-ES")}{" "}
                  palabras
                </span>
              </span>
              {isCurrent ? <Badge tone="accent">Actual</Badge> : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPreviewId(previewId === v.id ? null : v.id)}
                aria-label={previewId === v.id ? "Ocultar vista previa" : "Ver esta versión"}
              >
                {previewId === v.id ? <EyeOff /> : <Eye />}
              </Button>
              {!isCurrent ? (
                <Button variant="secondary" size="sm" onClick={() => restore.mutate(v.id)} disabled={restore.isPending}>
                  <RotateCcw /> Restaurar
                </Button>
              ) : null}
            </li>
          );
        })}
      </ol>
      {previewId ? (
        <div className="max-h-[50dvh] overflow-y-auto rounded-xl border border-border bg-sunken/40 p-4">
          {preview.isPending ? (
            <Skeleton className="h-20" />
          ) : preview.data ? (
            <DocumentView content={preview.data} className="lg:grid-cols-1 [&_nav]:hidden" />
          ) : (
            <p className="text-sm text-muted">No se pudo cargar la versión.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
