"use client";
import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Layers, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge, EmptyState, Skeleton } from "@/components/ui/misc";
import { api, errorMessage } from "@/lib/api/client";
import type { FlashcardView } from "@/lib/data/flashcards";
import type { JobRequest } from "@/lib/jobs/requests";
import { formatRelative } from "@/lib/time";
import { RefChips } from "./exam-tab";
import { EstimateLine, LanguageSelect, LaunchJobButton, useDefaultLanguage, type NotesLanguage } from "./generation";
import { activeJob, JobFailure, JobProgress, latestJob, useJobs } from "./job-progress";
import { Markdown } from "./markdown";

const TYPE_LABEL: Record<string, string> = {
  definition: "Definición",
  qa: "Pregunta",
  article: "Artículo",
  term: "Término",
  comparison: "Comparación",
  exception: "Excepción",
};

export function FlashcardsTab({ sessionId, onSeek }: { sessionId: string; onSeek: (ms: number) => void }) {
  const qc = useQueryClient();
  const [now] = React.useState(() => Date.now());
  const cards = useQuery({
    queryKey: ["flashcards", sessionId],
    queryFn: async () => (await api<{ cards: FlashcardView[] }>(`/api/sessions/${sessionId}/flashcards`)).cards,
  });
  const jobs = useJobs(sessionId);
  const defaultLanguage = useDefaultLanguage();
  const [language, setLanguage] = React.useState<NotesLanguage | null>(null);
  const [maxCards, setMaxCards] = React.useState(40);
  const [showGenerate, setShowGenerate] = React.useState(false);
  const running = activeJob(jobs.data, "flashcards");
  const last = latestJob(jobs.data, "flashcards");
  const lastStatus = last?.status;
  const refetch = cards.refetch;
  React.useEffect(() => {
    if (lastStatus === "completed") void refetch();
  }, [lastStatus, refetch]);
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/flashcards/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["flashcards", sessionId] }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (cards.isPending || jobs.isPending) return <Skeleton className="h-24" />;
  const lang = language ?? defaultLanguage;
  const request: JobRequest = { type: "flashcards", language: lang, maxCards };
  const list = cards.data ?? [];
  const due = list.filter((c) => !c.suspended && c.dueAt <= now).length;

  const form = (
    <div className="max-w-lg space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-soft">
      <div>
        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">
          {list.length ? "Generar más tarjetas" : "Generar flashcards"}
        </h2>
        <p className="mt-1 text-sm text-muted">
          Una idea por tarjeta, sin repetir conceptos ya existentes en la asignatura. Se repasan con repetición
          espaciada.
        </p>
      </div>
      <div>
        <Label htmlFor="max-cards">Máximo de tarjetas</Label>
        <Input
          id="max-cards"
          type="number"
          min={5}
          max={120}
          value={maxCards}
          onChange={(e) => setMaxCards(Math.max(5, Math.min(120, Number(e.target.value) || 40)))}
        />
      </div>
      <LanguageSelect value={lang} onChange={setLanguage} id="cards-language" />
      <EstimateLine sessionId={sessionId} request={request} />
      <div className="flex items-center gap-2">
        <LaunchJobButton sessionId={sessionId} request={request} label="Generar tarjetas" />
        {list.length ? (
          <Button variant="ghost" onClick={() => setShowGenerate(false)}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {running ? <JobProgress job={running} sessionId={sessionId} /> : null}
      {last && (last.status === "failed" || last.status === "cancelled") ? (
        <JobFailure job={last} sessionId={sessionId} />
      ) : null}
      {!running && (list.length === 0 || showGenerate) ? form : null}
      {list.length ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted">
              {list.length} tarjetas · {due} para repasar hoy
            </p>
            <Button variant="primary" size="sm" asChild>
              <Link href="/review">
                <Layers /> Repasar
              </Link>
            </Button>
            {!showGenerate && !running ? (
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setShowGenerate(true)}>
                <RefreshCw /> Generar más
              </Button>
            ) : null}
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {list.map((c) => (
              <li key={c.id} className="group rounded-xl border border-border bg-surface p-4 shadow-soft">
                <div className="flex items-center justify-between gap-2 text-[12px] text-muted">
                  <span className="inline-flex items-center gap-2">
                    <Badge tone="outline">{TYPE_LABEL[c.cardType] ?? c.cardType}</Badge>
                    {c.repetitions > 0 ? <span>próximo repaso {formatRelative(c.dueAt)}</span> : <span>nueva</span>}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="opacity-0 group-hover:opacity-100"
                    aria-label="Eliminar tarjeta"
                    onClick={() => remove.mutate(c.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <p className="mt-2 text-[15px] font-medium leading-snug">{c.front}</p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-[13px] text-accent">Ver reverso</summary>
                  <div className="mt-2 text-[14.5px]">
                    <Markdown markdown={c.back} className="max-w-none text-[14.5px]" />
                    {c.sourceRefs.length ? <RefChips refs={c.sourceRefs} onSeek={onSeek} /> : null}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </>
      ) : !running && last?.status === "completed" ? (
        <EmptyState
          icon={<Layers />}
          title="No se crearon tarjetas nuevas"
          description="Todos los conceptos detectados ya tenían tarjeta en esta asignatura."
        />
      ) : null}
    </div>
  );
}
