"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Clock3, GraduationCap, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge, Callout, EmptyState, Skeleton } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import type { QuestionView } from "@/lib/data/documents";
import type { SourceRef } from "@/lib/db/schema";
import type { JobRequest } from "@/lib/jobs/requests";
import { QUESTION_TYPE_LABEL } from "@/lib/notes/prompts";
import { formatClock } from "@/lib/time";
import { ExamMode } from "./exam-mode";
import { Markdown } from "./markdown";
import { EstimateLine, LanguageSelect, LaunchJobButton, useDefaultLanguage, type NotesLanguage } from "./generation";
import { activeJob, JobFailure, JobProgress, latestJob, useJobs } from "./job-progress";

type QType = QuestionView["qtype"];
const TYPES: QType[] = ["mcq", "short", "essay", "oral", "case"];
const DEFAULT_COUNTS: Record<QType, number> = { mcq: 8, short: 5, essay: 2, oral: 8, case: 2 };

export function useQuestions(sessionId: string) {
  return useQuery({
    queryKey: ["questions", sessionId],
    queryFn: async () => (await api<{ questions: QuestionView[] }>(`/api/sessions/${sessionId}/questions`)).questions,
  });
}

export function RefChips({ refs, onSeek }: { refs: SourceRef[]; onSeek: (ms: number) => void }) {
  const transcript = refs.filter((r): r is Extract<SourceRef, { kind: "transcript" }> => r.kind === "transcript");
  if (!transcript.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {transcript.slice(0, 4).map((r) => (
        <button
          key={`${r.seqFrom}-${r.seqTo}`}
          type="button"
          onClick={() => onSeek(r.startMs)}
          className="inline-flex h-5 items-center gap-1 rounded-md border border-border bg-sunken px-1.5 font-mono text-[11px] text-muted hover:border-accent hover:text-accent"
        >
          <Clock3 className="size-3" />
          {formatClock(r.startMs)}–{formatClock(r.endMs)}
        </button>
      ))}
    </span>
  );
}

function QuestionCard({ q, onSeek }: { q: QuestionView; onSeek: (ms: number) => void }) {
  const [open, setOpen] = React.useState(false);
  const refs = React.useMemo(
    () => q.sourceRefs.filter((r): r is Extract<SourceRef, { kind: "transcript" }> => r.kind === "transcript"),
    [q.sourceRefs],
  );
  return (
    <li className="rounded-xl border border-border bg-surface p-4 shadow-soft">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
        <Badge tone="outline">{QUESTION_TYPE_LABEL[q.qtype]}</Badge>
        {q.level ? <Badge tone="neutral">Nivel {q.level}</Badge> : null}
        <span className="truncate">{q.concept}</span>
        {q.extendsSyllabus ? <Badge tone="warning">Amplía el temario</Badge> : null}
      </div>
      <div className="mt-2 text-[15.5px] leading-relaxed">
        <Markdown markdown={q.prompt} refs={refs} onSeek={onSeek} className="max-w-none text-[15.5px]" />
      </div>
      {q.qtype === "mcq" && q.options ? (
        <ol className="mt-3 space-y-1.5">
          {q.options.map((o, i) => (
            <li
              key={i}
              className={cn(
                "flex gap-2 rounded-lg border border-border px-3 py-2 text-[14.5px]",
                open && i === q.correctOption && "border-accent bg-accent-soft/60",
              )}
            >
              <span className="font-mono text-[12px] text-muted">{String.fromCharCode(65 + i)}</span>
              <span>{o}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-accent"
        aria-expanded={open}
      >
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
        {open ? "Ocultar solución" : "Ver solución"}
      </button>
      {open ? (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <div>
            <p className="mb-1 text-[12px] font-medium uppercase tracking-[0.05em] text-subtle">Respuesta</p>
            <Markdown markdown={q.answer} refs={refs} onSeek={onSeek} className="max-w-none text-[15px]" />
          </div>
          {q.explanation ? (
            <div>
              <p className="mb-1 text-[12px] font-medium uppercase tracking-[0.05em] text-subtle">Explicación</p>
              <Markdown markdown={q.explanation} refs={refs} onSeek={onSeek} className="max-w-none text-[15px]" />
            </div>
          ) : null}
          {q.rubric?.length ? (
            <div>
              <p className="mb-1 text-[12px] font-medium uppercase tracking-[0.05em] text-subtle">
                Criterios de corrección
              </p>
              <ul className="list-disc pl-5 text-[14.5px] leading-relaxed">
                {q.rubric.map((r) => (
                  <li key={r}>
                    <Markdown
                      markdown={r}
                      refs={refs}
                      onSeek={onSeek}
                      className="max-w-none text-[14.5px] [&_p]:mb-0"
                    />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {q.sourceRefs.length ? (
            <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
              Basado en la clase: <RefChips refs={q.sourceRefs} onSeek={onSeek} />
            </p>
          ) : (
            <p className="text-[12.5px] text-warning">Sin referencia a un tramo concreto de la clase.</p>
          )}
        </div>
      ) : null}
    </li>
  );
}

export function ExamTab({ sessionId, onSeek }: { sessionId: string; onSeek: (ms: number) => void }) {
  const [mode, setMode] = React.useState<"list" | "exam">("list");
  const [examTypes, setExamTypes] = React.useState<QType[]>(TYPES);
  const questions = useQuestions(sessionId);
  const jobs = useJobs(sessionId);
  const defaultLanguage = useDefaultLanguage();
  const [language, setLanguage] = React.useState<NotesLanguage | null>(null);
  const [counts, setCounts] = React.useState<Record<QType, number>>(DEFAULT_COUNTS);
  const [replace, setReplace] = React.useState(false);
  const [showGenerate, setShowGenerate] = React.useState(false);
  const [filter, setFilter] = React.useState<QType | "all">("all");
  const running = activeJob(jobs.data, "exam");
  const last = latestJob(jobs.data, "exam");
  const lastStatus = last?.status;
  const refetch = questions.refetch;
  React.useEffect(() => {
    if (lastStatus === "completed") void refetch();
  }, [lastStatus, refetch]);

  if (questions.isPending || jobs.isPending) return <Skeleton className="h-24" />;
  const lang = language ?? defaultLanguage;
  const total = Object.values(counts).reduce((n, v) => n + v, 0);
  const request: JobRequest | null = total > 0 ? { type: "exam", language: lang, counts, replace } : null;
  const list = questions.data ?? [];
  const visible = filter === "all" ? list : list.filter((q) => q.qtype === filter);
  const byType = TYPES.map((t) => [t, list.filter((q) => q.qtype === t).length] as const).filter(([, n]) => n > 0);

  const form = (
    <div className="max-w-xl space-y-5 rounded-2xl border border-border bg-surface p-6 shadow-soft">
      <div>
        <h3 className="text-[17px] font-semibold tracking-[-0.01em]">
          {list.length ? "Generar más preguntas" : "Generar preguntas de examen"}
        </h3>
        <p className="mt-1 text-sm text-muted">
          Preguntas basadas solo en lo explicado en clase (y en los apuntes si existen). Las que requieran material no
          visto se marcan.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {TYPES.map((t) => (
          <div key={t}>
            <Label htmlFor={`count-${t}`} className="text-[12.5px]">
              {QUESTION_TYPE_LABEL[t]}
            </Label>
            <Input
              id={`count-${t}`}
              type="number"
              min={0}
              max={t === "essay" || t === "case" ? 20 : 40}
              value={counts[t]}
              onChange={(e) => setCounts({ ...counts, [t]: Math.max(0, Math.min(40, Number(e.target.value) || 0)) })}
            />
          </div>
        ))}
      </div>
      <LanguageSelect value={lang} onChange={setLanguage} id="exam-language" />
      {list.length ? (
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            Sustituir las preguntas existentes de esos tipos
            <span className="block text-[12.5px] text-muted">
              Desactivado: se añaden a las actuales evitando repetir conceptos.
            </span>
          </span>
          <Switch checked={replace} onCheckedChange={setReplace} aria-label="Sustituir preguntas existentes" />
        </label>
      ) : null}
      <EstimateLine sessionId={sessionId} request={request} />
      <div className="flex items-center gap-2">
        <LaunchJobButton sessionId={sessionId} request={request} label={`Generar ${total} preguntas`} />
        {list.length ? (
          <Button variant="ghost" onClick={() => setShowGenerate(false)}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </div>
  );

  if (mode === "exam") {
    return <ExamMode sessionId={sessionId} types={examTypes} onExit={() => setMode("list")} onSeek={onSeek} />;
  }

  return (
    <div className="space-y-6">
      {running ? <JobProgress job={running} sessionId={sessionId} /> : null}
      {list.length && !running && !showGenerate ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-soft">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-medium">Modo examen</p>
            <p className="text-[13px] text-muted">
              Una pregunta cada vez, sin ver la solución hasta responder. Prioriza lo que fallas.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {byType.map(([t]) => (
                <label
                  key={t}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-[12.5px]",
                    examTypes.includes(t) ? "border-accent bg-accent-soft/50" : "border-border text-muted",
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={examTypes.includes(t)}
                    onChange={(e) =>
                      setExamTypes(e.target.checked ? [...examTypes, t] : examTypes.filter((x) => x !== t))
                    }
                  />
                  {QUESTION_TYPE_LABEL[t]}
                </label>
              ))}
            </div>
          </div>
          <Button
            variant="primary"
            disabled={!examTypes.some((t) => byType.some(([b]) => b === t))}
            onClick={() => setMode("exam")}
          >
            <GraduationCap /> Empezar
          </Button>
        </div>
      ) : null}
      {last && (last.status === "failed" || last.status === "cancelled") ? (
        <JobFailure job={last} sessionId={sessionId} />
      ) : null}
      {!running && (list.length === 0 || showGenerate) ? form : null}
      {list.length ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="tablist"
              aria-label="Tipo de pregunta"
              className="flex flex-wrap rounded-lg bg-sunken p-0.5 text-[13px]"
            >
              <button
                role="tab"
                aria-selected={filter === "all"}
                onClick={() => setFilter("all")}
                className={cn(
                  "h-8 rounded-md px-3 font-medium text-muted",
                  filter === "all" && "bg-surface text-foreground shadow-soft",
                )}
              >
                Todas ({list.length})
              </button>
              {byType.map(([t, n]) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={filter === t}
                  onClick={() => setFilter(t)}
                  className={cn(
                    "h-8 rounded-md px-3 font-medium text-muted",
                    filter === t && "bg-surface text-foreground shadow-soft",
                  )}
                >
                  {QUESTION_TYPE_LABEL[t]} ({n})
                </button>
              ))}
            </div>
            {!showGenerate && !running ? (
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setShowGenerate(true)}>
                <RefreshCw /> Generar más
              </Button>
            ) : null}
          </div>
          {list.some((q) => q.extendsSyllabus) ? (
            <Callout tone="neutral" icon={<GraduationCap />}>
              Las preguntas marcadas «Amplía el temario» necesitan material que no se explicó en esta clase.
            </Callout>
          ) : null}
          <ul className="space-y-3">
            {visible.map((q) => (
              <QuestionCard key={q.id} q={q} onSeek={onSeek} />
            ))}
          </ul>
        </>
      ) : !running && list.length === 0 && !last ? null : null}
      {list.length === 0 && !running && last?.status === "completed" ? (
        <EmptyState
          icon={<GraduationCap />}
          title="No se generaron preguntas"
          description="El modelo no devolvió preguntas válidas. Prueba a generar de nuevo."
        />
      ) : null}
    </div>
  );
}
