"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { api } from "@/lib/api/client";
import type { DocumentView as DocumentRow } from "@/lib/data/documents";
import { qk } from "@/lib/hooks/queries";
import type { JobRequest } from "@/lib/jobs/requests";
import type { TranscriptRef } from "@/lib/notes/types";
import { downloadText, safeFileName } from "@/lib/transcription/clean";
import { formatDate } from "@/lib/time";
import { DocumentMeta, DocumentView, documentToMarkdown } from "./document-view";
import { EstimateLine, LanguageSelect, LaunchJobButton, useDefaultLanguage, type NotesLanguage } from "./generation";
import { activeJob, JobDone, JobFailure, JobProgress, latestJob, useJobs } from "./job-progress";
import type { LectureDetail } from "./lecture-page";

export function useDocuments(sessionId: string) {
  return useQuery({
    queryKey: qk.documents(sessionId),
    queryFn: async () => (await api<{ documents: DocumentRow[] }>(`/api/sessions/${sessionId}/documents`)).documents,
  });
}

function GenerateNotesPanel({ sessionId, compact }: { sessionId: string; compact?: boolean }) {
  const defaultLanguage = useDefaultLanguage();
  const [language, setLanguage] = React.useState<NotesLanguage | null>(null);
  const lang = language ?? defaultLanguage;
  const request: JobRequest = { type: "notes", language: lang, includeAttachments: true };
  return (
    <div
      className={
        compact ? "space-y-4" : "mx-auto max-w-lg space-y-5 rounded-2xl border border-border bg-surface p-6 shadow-soft"
      }
    >
      {!compact ? (
        <div>
          <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent">
            <FileText className="size-5" />
          </div>
          <h3 className="text-[17px] font-semibold tracking-[-0.01em]">Generar apuntes completos</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            La IA analiza toda la clase por bloques, construye un índice global y redacta cada apartado citando los
            tramos de la grabación. Suele tardar varios minutos en una clase de 90 minutos.
          </p>
        </div>
      ) : null}
      <LanguageSelect value={lang} onChange={setLanguage} />
      <EstimateLine sessionId={sessionId} request={request} />
      <LaunchJobButton
        sessionId={sessionId}
        request={request}
        label={compact ? "Regenerar apuntes" : "Generar apuntes completos"}
      />
      <p className="text-[12px] leading-relaxed text-subtle">
        La transcripción nunca se modifica. Las aclaraciones que no proceden de la clase se marcan como «Explicación
        complementaria».
      </p>
    </div>
  );
}

export function NotesTab({
  sessionId,
  lecture,
  onSeek,
}: {
  sessionId: string;
  lecture: LectureDetail | undefined;
  onSeek: (ms: number, ref?: TranscriptRef) => void;
}) {
  const docs = useDocuments(sessionId);
  const jobs = useJobs(sessionId);
  const [regenOpen, setRegenOpen] = React.useState(false);
  const notes = docs.data?.find((d) => d.kind === "notes" && d.content);
  const running = activeJob(jobs.data, "notes");
  const last = latestJob(jobs.data, "notes");

  // Refresh documents when a notes job finishes.
  const lastStatus = last?.status;
  const lastId = last?.id;
  const refetchDocs = docs.refetch;
  React.useEffect(() => {
    if (lastStatus === "completed") void refetchDocs();
  }, [lastStatus, lastId, refetchDocs]);

  if (docs.isPending || jobs.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  if (running) {
    return (
      <div className="space-y-6">
        <JobProgress job={running} sessionId={sessionId} />
        {notes?.content ? (
          <p className="text-sm text-muted">
            Mientras tanto puedes seguir leyendo la versión actual (v{notes.versionNumber}).
          </p>
        ) : null}
        {notes?.content ? <DocumentView content={notes.content} onSeek={onSeek} /> : null}
      </div>
    );
  }

  if (!notes?.content) {
    return (
      <div className="space-y-6">
        {last && (last.status === "failed" || last.status === "cancelled") ? (
          <JobFailure job={last} sessionId={sessionId} />
        ) : null}
        {lecture && lecture.segmentCount === 0 ? (
          <EmptyState
            icon={<FileText />}
            title="Sin transcripción"
            description="No se puede generar apuntes de una clase sin transcripción."
          />
        ) : (
          <GenerateNotesPanel sessionId={sessionId} />
        )}
      </div>
    );
  }

  const content = notes.content;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <h2 className="text-[20px] font-semibold tracking-[-0.015em]">{content.title}</h2>
          <DocumentMeta content={content} extra={<span>v{notes.versionNumber}</span>} />
          {last?.status === "completed" ? <JobDone job={last} /> : null}
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() =>
              downloadText(
                `${safeFileName(lecture?.title ?? content.title)}-apuntes.md`,
                documentToMarkdown(content, {
                  subject: lecture?.subjectName,
                  date: lecture ? formatDate(lecture.startedAt ?? lecture.createdAt) : undefined,
                }),
                "text/markdown;charset=utf-8",
              )
            }
          >
            <Download /> Markdown
          </Button>
          <Button variant="secondary" onClick={() => setRegenOpen(true)}>
            <RefreshCw /> Regenerar
          </Button>
        </div>
      </div>
      {last && (last.status === "failed" || last.status === "cancelled") ? (
        <JobFailure job={last} sessionId={sessionId} />
      ) : null}
      <DocumentView content={content} onSeek={onSeek} />
      <Dialog open={regenOpen} onOpenChange={setRegenOpen}>
        <DialogContent
          title="Regenerar apuntes"
          description="Se creará una nueva versión. La actual se conserva en el historial."
        >
          <GenerateNotesPanel sessionId={sessionId} compact />
        </DialogContent>
      </Dialog>
    </div>
  );
}
