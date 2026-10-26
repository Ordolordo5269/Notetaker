"use client";
import * as React from "react";
import { FileText, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout, EmptyState, Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import type { JobRequest } from "@/lib/jobs/requests";
import { SUMMARY_SPECS, type SummaryMode } from "@/lib/notes/prompts";
import type { TranscriptRef } from "@/lib/notes/types";
import { DocumentMeta, DocumentView } from "./document-view";
import { EstimateLine, LanguageSelect, LaunchJobButton, useDefaultLanguage, type NotesLanguage } from "./generation";
import { activeJob, JobFailure, JobProgress, latestJob, useJobs } from "./job-progress";
import { useDocuments } from "./notes-tab";

const MODES: SummaryMode[] = ["summary_quick", "summary_full", "summary_last_minute"];
const MODE_HINT: Record<SummaryMode, string> = {
  summary_quick: "Visión general en una página.",
  summary_full: "Resumen intermedio para repasar tras estudiar los apuntes.",
  summary_last_minute: "Lo imprescindible para los minutos previos al examen.",
};

export function SummaryTab({
  sessionId,
  onSeek,
}: {
  sessionId: string;
  onSeek: (ms: number, ref?: TranscriptRef) => void;
}) {
  const docs = useDocuments(sessionId);
  const jobs = useJobs(sessionId);
  const defaultLanguage = useDefaultLanguage();
  const [language, setLanguage] = React.useState<NotesLanguage | null>(null);
  const [mode, setMode] = React.useState<SummaryMode>("summary_quick");
  const [showGenerate, setShowGenerate] = React.useState(false);
  const notes = docs.data?.find((d) => d.kind === "notes" && d.content);
  const running = activeJob(jobs.data, "summaries");
  const last = latestJob(jobs.data, "summaries");
  const lastStatus = last?.status;
  const refetchDocs = docs.refetch;
  React.useEffect(() => {
    if (lastStatus === "completed") void refetchDocs();
  }, [lastStatus, refetchDocs]);

  if (docs.isPending || jobs.isPending) return <Skeleton className="h-24" />;
  if (!notes) {
    return (
      <EmptyState
        icon={<FileText />}
        title="Primero los apuntes"
        description="Los resúmenes se construyen a partir de los apuntes completos para no perder fidelidad. Genéralos en la pestaña Apuntes."
      />
    );
  }
  const lang = language ?? defaultLanguage;
  const request: JobRequest = { type: "summaries", language: lang };
  const summaries = MODES.map((m) => docs.data?.find((d) => d.kind === m && d.content)).filter(Boolean);
  const current = docs.data?.find((d) => d.kind === mode && d.content);

  return (
    <div className="space-y-6">
      {running ? <JobProgress job={running} sessionId={sessionId} /> : null}
      {last && (last.status === "failed" || last.status === "cancelled") ? (
        <JobFailure job={last} sessionId={sessionId} />
      ) : null}
      {!running && (summaries.length === 0 || showGenerate) ? (
        <div className="max-w-lg space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-soft">
          <div>
            <h3 className="text-[17px] font-semibold tracking-[-0.01em]">
              {summaries.length ? "Regenerar los resúmenes" : "Generar los tres modos de repaso"}
            </h3>
            <p className="mt-1 text-sm text-muted">
              Repaso rápido, repaso completo y última hora, derivados de los apuntes v{notes.versionNumber}.
            </p>
          </div>
          <LanguageSelect value={lang} onChange={setLanguage} id="summary-language" />
          <EstimateLine sessionId={sessionId} request={request} />
          <div className="flex items-center gap-2">
            <LaunchJobButton sessionId={sessionId} request={request} label="Generar resúmenes" />
            {summaries.length ? (
              <Button variant="ghost" onClick={() => setShowGenerate(false)}>
                Cancelar
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {summaries.length ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label="Modo de repaso" className="flex rounded-lg bg-sunken p-0.5 text-[13px]">
              {MODES.map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "h-8 rounded-md px-3 font-medium text-muted transition-colors",
                    mode === m && "bg-surface text-foreground shadow-soft",
                  )}
                >
                  {SUMMARY_SPECS[m].title}
                </button>
              ))}
            </div>
            <span className="text-[12.5px] text-muted">{MODE_HINT[mode]}</span>
            {!showGenerate && !running ? (
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setShowGenerate(true)}>
                <RefreshCw /> Regenerar
              </Button>
            ) : null}
          </div>
          {current?.content ? (
            <>
              <DocumentMeta content={current.content} extra={<span>v{current.versionNumber}</span>} />
              <DocumentView content={current.content} onSeek={onSeek} />
            </>
          ) : (
            <Callout tone="neutral">Este modo todavía no se ha generado.</Callout>
          )}
        </>
      ) : null}
    </div>
  );
}
