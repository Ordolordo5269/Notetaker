"use client";
import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Check, CircleHelp, Trophy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Badge, Callout, Spinner } from "@/components/ui/misc";
import { api, errorMessage } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import type { QuestionPrompt } from "@/lib/data/exam";
import type { SourceRef } from "@/lib/db/schema";
import { QUESTION_TYPE_LABEL } from "@/lib/notes/prompts";
import { RefChips } from "./exam-tab";
import { Markdown } from "./markdown";

type QType = QuestionPrompt["qtype"];

interface AttemptResult {
  score: number;
  verdict: "correct" | "partial" | "incorrect";
  feedback: string;
  solution: {
    answer: string;
    explanation: string | null;
    rubric: string[] | null;
    correctOption: number | null;
    sourceRefs: SourceRef[];
  };
}

const VERDICT: Record<
  AttemptResult["verdict"],
  { label: string; tone: "accent" | "warning" | "danger"; icon: React.ReactNode }
> = {
  correct: { label: "Correcta", tone: "accent", icon: <Check /> },
  partial: { label: "Parcial", tone: "warning", icon: <CircleHelp /> },
  incorrect: { label: "Incorrecta", tone: "danger", icon: <X /> },
};

export function ExamMode({
  sessionId,
  types,
  onExit,
  onSeek,
}: {
  sessionId: string;
  types: QType[];
  onExit: () => void;
  onSeek: (ms: number) => void;
}) {
  const [asked, setAsked] = React.useState<string[]>([]);
  const [results, setResults] = React.useState<{ id: string; score: number; concept: string }[]>([]);
  const [selected, setSelected] = React.useState<number | null>(null);
  const [answer, setAnswer] = React.useState("");
  const [result, setResult] = React.useState<AttemptResult | null>(null);
  const [finished, setFinished] = React.useState(false);

  const typeQuery = types.map((t) => `type=${t}`).join("&");
  const next = useQuery({
    queryKey: ["exam-next", sessionId, typeQuery, asked.join(",")],
    queryFn: () =>
      api<{ next: { question: QuestionPrompt; remaining: number } | null }>(
        `/api/sessions/${sessionId}/exam/next?${typeQuery}${asked.map((id) => `&exclude=${id}`).join("")}`,
      ),
    enabled: !finished,
    staleTime: Infinity,
  });
  const question = next.data?.next?.question ?? null;

  const grade = useMutation({
    mutationFn: () =>
      api<AttemptResult>(`/api/sessions/${sessionId}/exam/attempts`, {
        body: {
          questionId: question!.id,
          selectedOption: question!.qtype === "mcq" ? selected : null,
          answer: question!.qtype === "mcq" ? null : answer,
        },
      }),
    onSuccess: (r) => {
      setResult(r);
      setResults((prev) => [...prev, { id: question!.id, score: r.score, concept: question!.concept }]);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  function proceed() {
    if (!question) return;
    setAsked((a) => [...a, question.id]);
    setSelected(null);
    setAnswer("");
    setResult(null);
  }

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
      if (result && (e.key === "Enter" || e.key === "n")) proceed();
      if (!result && question?.qtype === "mcq" && /^[1-4]$/.test(e.key)) setSelected(Number(e.key) - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- proceed/setSelected are stable for this effect's purpose
  }, [result, question]);

  const total = results.length;
  const avg = total ? results.reduce((n, r) => n + r.score, 0) / total : 0;

  if (finished || (next.data && !next.data.next)) {
    const weak = results.filter((r) => r.score < 0.75);
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-border bg-surface p-6 text-center shadow-soft">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Trophy className="size-6" />
        </div>
        <h2 className="text-[20px] font-semibold tracking-[-0.015em]">
          {total ? "Sesión terminada" : "No quedan preguntas"}
        </h2>
        {total ? (
          <p className="mt-1 text-muted">
            {total} {total === 1 ? "pregunta" : "preguntas"} · puntuación media {Math.round(avg * 100)}%
          </p>
        ) : (
          <p className="mt-1 text-muted">Genera más preguntas para seguir practicando.</p>
        )}
        {weak.length ? (
          <div className="mt-4 text-left">
            <p className="text-[12.5px] font-medium uppercase tracking-[0.05em] text-subtle">Conceptos a repasar</p>
            <ul className="mt-1 space-y-1 text-sm">
              {weak.map((w) => (
                <li key={w.id} className="flex items-center justify-between rounded-lg bg-sunken px-3 py-1.5">
                  <span>{w.concept}</span>
                  <span className="font-mono text-[12px] text-muted">{Math.round(w.score * 100)}%</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="mt-4 text-[12.5px] text-subtle">
          Tu progreso se guarda por asignatura; las próximas sesiones priorizan lo que fallaste.
        </p>
        <Button className="mt-5" variant="primary" onClick={onExit}>
          Volver a las preguntas
        </Button>
      </div>
    );
  }

  if (next.isPending || !question) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> Preparando la siguiente pregunta…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between text-[12.5px] text-muted">
        <span>
          Pregunta {total + 1}
          {next.data?.next ? ` · quedan ${next.data.next.remaining}` : ""}
        </span>
        <Button variant="ghost" size="sm" onClick={() => setFinished(true)}>
          Terminar sesión
        </Button>
      </div>
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-soft">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <Badge tone="outline">{QUESTION_TYPE_LABEL[question.qtype]}</Badge>
          {question.level ? <Badge tone="neutral">Nivel {question.level}</Badge> : null}
          <span>{question.concept}</span>
        </div>
        <Markdown markdown={question.prompt} className="max-w-none text-[16px]" />

        {question.qtype === "mcq" && question.options ? (
          <ol className="mt-4 space-y-2" role="radiogroup" aria-label="Opciones">
            {question.options.map((o, i) => {
              const isCorrect = result?.solution.correctOption === i;
              const isSelected = selected === i;
              return (
                <li key={i}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    disabled={Boolean(result)}
                    onClick={() => setSelected(i)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-xl border px-3.5 py-2.5 text-left text-[15px] transition",
                      isSelected && !result && "border-accent bg-accent-soft/50",
                      !isSelected && !result && "border-border hover:border-border-strong",
                      result && isCorrect && "border-accent bg-accent-soft/60",
                      result && isSelected && !isCorrect && "border-danger bg-danger-soft",
                      result && !isSelected && !isCorrect && "border-border opacity-70",
                    )}
                  >
                    <span className="mt-0.5 font-mono text-[12px] text-muted">{String.fromCharCode(65 + i)}</span>
                    <span>{o}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        ) : (
          <Textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            disabled={Boolean(result)}
            rows={question.qtype === "short" ? 4 : 9}
            placeholder={question.qtype === "oral" ? "Escribe lo que responderías en voz alta…" : "Tu respuesta…"}
            className="mt-4"
            aria-label="Respuesta"
          />
        )}

        {!result ? (
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-[12.5px] text-subtle">
              {question.qtype === "mcq"
                ? "Teclas 1-4 para elegir."
                : "Las respuestas abiertas las corrige la IA con la respuesta modelo y los criterios."}
            </p>
            <Button
              variant="primary"
              disabled={grade.isPending || (question.qtype === "mcq" ? selected === null : answer.trim().length === 0)}
              onClick={() => grade.mutate()}
            >
              {grade.isPending ? <Spinner /> : null}
              Responder
            </Button>
          </div>
        ) : (
          <div className="mt-5 space-y-4 border-t border-border pt-4">
            <div className="flex items-center gap-2">
              <Badge tone={VERDICT[result.verdict].tone} className="h-6 px-2 text-[12.5px]">
                {VERDICT[result.verdict].icon} {VERDICT[result.verdict].label}
              </Badge>
              {question.qtype !== "mcq" ? (
                <span className="text-[13px] text-muted">{Math.round(result.score * 100)}%</span>
              ) : null}
            </div>
            {result.feedback ? (
              <Callout tone="neutral" title="Corrección">
                <Markdown markdown={result.feedback} className="max-w-none text-[14px]" />
              </Callout>
            ) : null}
            <div>
              <p className="mb-1 text-[12px] font-medium uppercase tracking-[0.05em] text-subtle">Respuesta modelo</p>
              <Markdown markdown={result.solution.answer} className="max-w-none text-[15px]" />
            </div>
            {result.solution.explanation ? (
              <div>
                <p className="mb-1 text-[12px] font-medium uppercase tracking-[0.05em] text-subtle">Explicación</p>
                <Markdown markdown={result.solution.explanation} className="max-w-none text-[15px]" />
              </div>
            ) : null}
            {result.solution.sourceRefs.length ? (
              <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                Basado en la clase: <RefChips refs={result.solution.sourceRefs} onSeek={onSeek} />
              </p>
            ) : null}
            <div className="flex justify-end">
              <Button variant="primary" onClick={proceed}>
                Siguiente <ArrowRight />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
