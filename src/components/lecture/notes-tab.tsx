"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, History, MoreHorizontal, Pencil, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Label, Textarea } from "@/components/ui/input";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { api, errorMessage } from "@/lib/api/client";
import type { DocumentView as DocumentRow } from "@/lib/data/documents";
import { exportAndDownload, studyDocToExport } from "@/lib/export";
import { qk } from "@/lib/hooks/queries";
import type { JobRequest } from "@/lib/jobs/requests";
import type { DocumentSection, TranscriptRef } from "@/lib/notes/types";
import { downloadText, safeFileName } from "@/lib/transcription/clean";
import { formatDate, formatDuration } from "@/lib/time";
import { DocumentMeta, DocumentView, documentToMarkdown } from "./document-view";
import { ExportMenu } from "./export-menu";
import { EstimateLine, LanguageSelect, LaunchJobButton, useDefaultLanguage, type NotesLanguage } from "./generation";
import { activeJob, JobDone, JobFailure, JobProgress, latestJob, useJobs } from "./job-progress";
import type { LectureDetail } from "./lecture-page";
import { SectionEditor } from "./section-editor";
import { VersionHistoryDialog } from "./version-history";

export function useDocuments(sessionId: string) {
  return useQuery({
    queryKey: qk.documents(sessionId),
    queryFn: async () => (await api<{ documents: DocumentRow[] }>(`/api/sessions/${sessionId}/documents`)).documents,
  });
}

export function lectureMeta(lecture: LectureDetail | undefined, fallbackTitle: string) {
  return {
    title: lecture?.title ?? fallbackTitle,
    subject: lecture?.subjectName,
    date: lecture ? formatDate(lecture.startedAt ?? lecture.createdAt) : undefined,
    duration: lecture ? formatDuration(lecture.durationMs) : undefined,
  };
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

function RegenerateSectionDialog({
  sessionId,
  section,
  onOpenChange,
}: {
  sessionId: string;
  section: DocumentSection | null;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={Boolean(section)} onOpenChange={onOpenChange}>
      <DialogContent
        title="Regenerar esta sección"
        description="Solo se vuelve a redactar este apartado a partir de sus tramos de la grabación. El resto del documento no cambia y la versión actual queda en el historial."
      >
        {section ? (
          <RegenerateSectionForm sessionId={sessionId} section={section} onLaunched={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RegenerateSectionForm({
  sessionId,
  section,
  onLaunched,
}: {
  sessionId: string;
  section: DocumentSection;
  onLaunched: () => void;
}) {
  const [instructions, setInstructions] = React.useState("");
  const request: JobRequest = {
    type: "section",
    sectionId: section.id,
    instructions: instructions.trim() || undefined,
    language: "auto",
  };
  return (
    <div className="space-y-4">
      <p className="text-sm">
        <span className="text-muted">Sección:</span> <span className="font-medium">{section.heading}</span>
      </p>
      <div>
        <Label htmlFor="section-instructions">Indicaciones (opcional)</Label>
        <Textarea
          id="section-instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          maxLength={600}
          rows={3}
          placeholder="Por ejemplo: «explica el ejemplo del contrato con más detalle» o «usa una tabla para comparar los foros»."
        />
        <p className="mt-1 text-[12px] text-subtle">
          La IA sigue sin poder añadir nada que no esté en la grabación o en las diapositivas.
        </p>
      </div>
      <EstimateLine sessionId={sessionId} request={request} />
      <LaunchJobButton sessionId={sessionId} request={request} label="Regenerar sección" onLaunched={onLaunched} />
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
  const qc = useQueryClient();
  const docs = useDocuments(sessionId);
  const jobs = useJobs(sessionId);
  const [regenOpen, setRegenOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [regenSection, setRegenSection] = React.useState<DocumentSection | null>(null);
  const notes = docs.data?.find((d) => d.kind === "notes" && d.content);
  const running = activeJob(jobs.data, "notes");
  const last = latestJob(jobs.data, "notes");
  const sectionRunning = activeJob(jobs.data, "section");
  const lastSection = latestJob(jobs.data, "section");

  // Refresh documents when a notes or section job finishes.
  const lastStatus = last?.status;
  const lastId = last?.id;
  const lastSectionStatus = lastSection?.status;
  const lastSectionId = lastSection?.id;
  const refetchDocs = docs.refetch;
  React.useEffect(() => {
    if (lastStatus === "completed" || lastSectionStatus === "completed") void refetchDocs();
  }, [lastStatus, lastId, lastSectionStatus, lastSectionId, refetchDocs]);

  const saveSection = useMutation({
    mutationFn: (input: { documentId: string; sectionId: string; heading: string; markdown: string }) =>
      api<{ versionNumber: number }>(`/api/documents/${input.documentId}/sections/${input.sectionId}`, {
        method: "PATCH",
        body: { heading: input.heading, markdown: input.markdown },
      }),
    onSuccess: (r) => {
      setEditingId(null);
      void qc.invalidateQueries({ queryKey: qk.documents(sessionId) });
      toast.success(`Sección guardada como versión ${r.versionNumber}.`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

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
  const meta = lectureMeta(lecture, content.title);
  const base = `${safeFileName(meta.title)}-apuntes`;
  const exportDoc = () => studyDocToExport(content, meta, { kindLabel: "Apuntes completos" });
  const exportGroups = [
    {
      label: "Apuntes completos",
      items: [
        { label: "PDF", run: () => exportAndDownload("pdf", exportDoc(), base) },
        { label: "Word (DOCX)", run: () => exportAndDownload("docx", exportDoc(), base) },
        {
          label: "Markdown",
          run: () =>
            downloadText(
              `${base}.md`,
              documentToMarkdown(content, { subject: meta.subject, date: meta.date }),
              "text/markdown;charset=utf-8",
            ),
        },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <h2 className="text-[20px] font-semibold tracking-[-0.015em]">{content.title}</h2>
          <DocumentMeta content={content} extra={<span>v{notes.versionNumber}</span>} />
          {last?.status === "completed" && notes.origin === "ai" ? <JobDone job={last} /> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportMenu groups={exportGroups} />
          <Button variant="secondary" onClick={() => setHistoryOpen(true)}>
            <History /> Historial
          </Button>
          <Button variant="secondary" onClick={() => setRegenOpen(true)}>
            <RefreshCw /> Regenerar
          </Button>
        </div>
      </div>
      {sectionRunning ? <JobProgress job={sectionRunning} sessionId={sessionId} /> : null}
      {last && (last.status === "failed" || last.status === "cancelled") ? (
        <JobFailure job={last} sessionId={sessionId} />
      ) : null}
      {lastSection && !sectionRunning && (lastSection.status === "failed" || lastSection.status === "cancelled") ? (
        <JobFailure job={lastSection} sessionId={sessionId} />
      ) : null}
      <DocumentView
        content={content}
        onSeek={onSeek}
        renderSectionActions={(section) =>
          editingId || sectionRunning ? null : (
            <Menu>
              <MenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Acciones de la sección ${section.heading}`}
                  className="text-muted opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                >
                  <MoreHorizontal />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem onSelect={() => setEditingId(section.id)}>
                  <Pencil /> Editar sección
                </MenuItem>
                <MenuItem onSelect={() => setRegenSection(section)}>
                  <Sparkles /> Regenerar con la IA…
                </MenuItem>
              </MenuContent>
            </Menu>
          )
        }
        renderSection={(section) =>
          editingId === section.id ? (
            <SectionEditor
              key={`${notes.currentVersionId}-${section.id}`}
              heading={section.heading}
              markdown={section.markdown}
              saving={saveSection.isPending}
              onCancel={() => setEditingId(null)}
              onSave={(next) =>
                saveSection.mutate({
                  documentId: notes.id,
                  sectionId: section.id,
                  heading: next.heading,
                  markdown: next.markdown,
                })
              }
            />
          ) : undefined
        }
      />
      <Dialog open={regenOpen} onOpenChange={setRegenOpen}>
        <DialogContent
          title="Regenerar apuntes"
          description="Se creará una nueva versión. La actual se conserva en el historial."
        >
          <GenerateNotesPanel sessionId={sessionId} compact />
        </DialogContent>
      </Dialog>
      <RegenerateSectionDialog
        sessionId={sessionId}
        section={regenSection}
        onOpenChange={(o) => !o && setRegenSection(null)}
      />
      <VersionHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        documentId={notes.id}
        sessionId={sessionId}
        currentVersionId={notes.currentVersionId}
      />
    </div>
  );
}
