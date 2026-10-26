"use client";
import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Clock3, Layers, RotateCcw } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/app/app-shell";
import { SubjectDot } from "@/components/app/subject-dot";
import { Markdown } from "@/components/lecture/markdown";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { api, errorMessage } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import type { FlashcardView, ReviewSummary } from "@/lib/data/flashcards";
import type { ReviewGrade } from "@/lib/db/schema";
import { GRADE_LABEL, previewInterval } from "@/lib/study/srs";
import { formatClock, formatRelative } from "@/lib/time";

const GRADES: ReviewGrade[] = ["again", "hard", "good", "easy"];
const GRADE_KEYS: Record<string, ReviewGrade> = { "1": "again", "2": "hard", "3": "good", "4": "easy" };

export function ReviewPage() {
  const qc = useQueryClient();
  const [subjectId, setSubjectId] = React.useState<string | null | "all">("all");
  const [queue, setQueue] = React.useState<FlashcardView[] | null>(null);
  const [revealed, setRevealed] = React.useState(false);
  const [done, setDone] = React.useState(0);

  const data = useQuery({
    queryKey: ["review", subjectId],
    queryFn: () =>
      api<{ cards: FlashcardView[]; summary: ReviewSummary[] }>(
        `/api/flashcards?due=1&limit=100${subjectId && subjectId !== "all" ? `&subjectId=${subjectId}` : ""}`,
      ),
  });

  // The session queue starts from the server's due cards and is then trimmed
  // locally as cards are graded (no refetch mid-session, so order is stable).
  const sessionQueue = queue ?? data.data?.cards ?? null;
  const card = sessionQueue?.[0] ?? null;
  const grade = useMutation({
    mutationFn: (g: ReviewGrade) =>
      api<{ next: { dueAt: number } }>(`/api/flashcards/${card!.id}/review`, { body: { grade: g } }),
    onSuccess: ({ next }, g) => {
      setQueue((q) => {
        const base = q ?? data.data?.cards ?? [];
        const [first, ...rest] = base;
        // "again" comes back at the end of this session.
        return g === "again" && first ? [...rest, { ...first, dueAt: next.dueAt }] : rest;
      });
      if (g !== "again") setDone((d) => d + 1);
      setRevealed(false);
      void qc.invalidateQueries({ queryKey: ["review"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!card) return;
      if (e.key === " " || e.key === "Enter") {
        if (!revealed) {
          e.preventDefault();
          setRevealed(true);
        }
      } else if (revealed && GRADE_KEYS[e.key] && !grade.isPending) {
        grade.mutate(GRADE_KEYS[e.key]!);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, revealed, grade]);

  const summary = data.data?.summary ?? [];
  const totalDue = summary.reduce((n, s) => n + s.due, 0);

  return (
    <PageContainer>
      <PageHeader title="Repaso" description="Repetición espaciada con las tarjetas generadas de tus clases." />
      <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
        <div>
          {data.isPending || sessionQueue === null ? (
            <Skeleton className="h-64 rounded-2xl" />
          ) : card ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-[12.5px] text-muted">
                <span>
                  {done} repasadas · {sessionQueue.length} pendientes en esta sesión
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <SubjectDot color={null} />
                  {card.subjectName ?? "Sin asignatura"} · {card.lectureTitle ?? ""}
                </span>
              </div>
              <div className="min-h-64 rounded-2xl border border-border bg-surface p-6 shadow-soft sm:p-8">
                <p className="text-[12px] font-medium uppercase tracking-[0.05em] text-subtle">Anverso</p>
                <p className="mt-2 text-[20px] font-medium leading-snug tracking-[-0.01em]">{card.front}</p>
                {revealed ? (
                  <div className="mt-6 border-t border-border pt-5">
                    <p className="text-[12px] font-medium uppercase tracking-[0.05em] text-subtle">Reverso</p>
                    <Markdown markdown={card.back} className="mt-2 max-w-none text-[16px]" />
                    {card.sourceRefs.length && card.sessionId ? (
                      <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
                        Basado en la clase:
                        {card.sourceRefs
                          .filter((r) => r.kind === "transcript")
                          .slice(0, 3)
                          .map((r) =>
                            r.kind === "transcript" ? (
                              <Link
                                key={`${r.seqFrom}-${r.seqTo}`}
                                href={`/lectures/${card.sessionId}?tab=transcript&t=${r.startMs}`}
                                className="inline-flex h-5 items-center gap-1 rounded-md border border-border bg-sunken px-1.5 font-mono text-[11px] hover:border-accent hover:text-accent"
                              >
                                <Clock3 className="size-3" /> {formatClock(r.startMs)}
                              </Link>
                            ) : null,
                          )}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {!revealed ? (
                <Button variant="primary" size="lg" className="w-full" onClick={() => setRevealed(true)}>
                  Mostrar respuesta <span className="ml-1 text-[12px] opacity-70">(espacio)</span>
                </Button>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {GRADES.map((g, i) => (
                    <Button
                      key={g}
                      variant={g === "again" ? "danger-ghost" : g === "good" ? "primary" : "secondary"}
                      size="lg"
                      className={cn("h-auto flex-col gap-0.5 py-2.5", g === "again" && "border border-danger/30")}
                      disabled={grade.isPending}
                      onClick={() => grade.mutate(g)}
                    >
                      <span className="text-[14px]">{GRADE_LABEL[g]}</span>
                      <span className="text-[11px] opacity-70">
                        {previewInterval(card, g)} · tecla {i + 1}
                      </span>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <EmptyState
              icon={done ? <Check /> : <Layers />}
              title={done ? "Repaso de hoy completado" : "No hay tarjetas pendientes"}
              description={
                summary.length
                  ? `Has repasado ${done} tarjetas. ${
                      summary.some((s) => s.nextDueAt)
                        ? `Próximas ${formatRelative(Math.min(...summary.filter((s) => s.nextDueAt).map((s) => s.nextDueAt!)))}.`
                        : ""
                    }`
                  : "Genera flashcards desde la pestaña Flashcards de una clase."
              }
              action={
                done ? (
                  <Button variant="secondary" onClick={() => setQueue(null)}>
                    <RotateCcw /> Buscar más tarjetas
                  </Button>
                ) : null
              }
            />
          )}
        </div>
        <aside>
          <p className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.06em] text-subtle">Por asignatura</p>
          <ul className="space-y-0.5">
            <li>
              <button
                type="button"
                onClick={() => {
                  setSubjectId("all");
                  setQueue(null);
                  setDone(0);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[13.5px] hover:bg-sunken",
                  subjectId === "all" && "bg-sunken font-medium",
                )}
              >
                <span>Todas</span>
                <span className="text-[12px] text-muted">{totalDue}</span>
              </button>
            </li>
            {summary.map((s) => (
              <li key={s.subjectId ?? "none"}>
                <button
                  type="button"
                  onClick={() => {
                    setSubjectId(s.subjectId);
                    setQueue(null);
                    setDone(0);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[13.5px] hover:bg-sunken",
                    subjectId === s.subjectId && "bg-sunken font-medium",
                  )}
                >
                  <span className="truncate">{s.subjectName ?? "Sin asignatura"}</span>
                  <span className="text-[12px] text-muted">
                    {s.due}/{s.total}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </PageContainer>
  );
}
