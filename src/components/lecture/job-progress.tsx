"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout, Spinner } from "@/components/ui/misc";
import { api, errorMessage } from "@/lib/api/client";
import type { JobType } from "@/lib/db/schema";
import { qk } from "@/lib/hooks/queries";
import type { JobView } from "@/lib/jobs/queue";
import { JOB_LABEL } from "@/lib/notes/estimate";
import { formatRelative } from "@/lib/time";

export function useJobs(sessionId: string) {
  return useQuery({
    queryKey: qk.jobs(sessionId),
    queryFn: async () => (await api<{ jobs: JobView[] }>(`/api/sessions/${sessionId}/jobs`)).jobs,
    refetchInterval: (q) => (q.state.data?.some((j) => j.status === "queued" || j.status === "running") ? 2500 : false),
  });
}

export function activeJob(jobs: JobView[] | undefined, type: JobType): JobView | undefined {
  return jobs?.find((j) => j.jobType === type && (j.status === "queued" || j.status === "running"));
}

export function latestJob(jobs: JobView[] | undefined, type: JobType): JobView | undefined {
  return jobs?.find((j) => j.jobType === type);
}

/** Live status of a running job: real stages, cost so far, cancel. */
export function JobProgress({ job, sessionId }: { job: JobView; sessionId: string }) {
  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => api(`/api/jobs/${job.id}/cancel`, { method: "POST", body: {} }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.jobs(sessionId) }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
      <div className="flex items-start gap-3">
        <Spinner className="mt-0.5 size-5 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium">{JOB_LABEL[job.jobType]} en curso</p>
          <p className="mt-0.5 text-sm text-muted" aria-live="polite">
            {job.status === "queued" ? "En cola…" : (job.stage ?? "Procesando…")}
          </p>
          <p className="mt-2 text-[12.5px] text-subtle">
            Iniciado {formatRelative(job.startedAt ?? job.createdAt)} · coste real hasta ahora {job.costUsd.toFixed(3)}{" "}
            USD
            {job.estimatedCostUsd !== null ? ` (estimado ${job.estimatedCostUsd.toFixed(2)} USD)` : ""}. Puedes salir de
            esta página; el trabajo continúa.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
          <X /> Cancelar
        </Button>
      </div>
    </div>
  );
}

export function JobFailure({ job, sessionId }: { job: JobView; sessionId: string }) {
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: () => api(`/api/jobs/${job.id}/retry`, { method: "POST", body: {} }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.jobs(sessionId) }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Callout
      tone={job.status === "cancelled" ? "neutral" : "danger"}
      icon={job.status === "cancelled" ? <X /> : <AlertTriangle />}
      title={job.status === "cancelled" ? `${JOB_LABEL[job.jobType]}: cancelado` : `${JOB_LABEL[job.jobType]}: falló`}
      action={
        <Button variant="secondary" size="sm" onClick={() => retry.mutate()} disabled={retry.isPending}>
          <RotateCcw /> Reintentar
        </Button>
      }
    >
      {job.error ?? "Sin detalle."}{" "}
      {job.costUsd > 0
        ? `Coste consumido: ${job.costUsd.toFixed(3)} USD. Los pasos completados se reutilizan al reintentar.`
        : ""}
    </Callout>
  );
}

export function JobDone({ job }: { job: JobView }) {
  return (
    <p className="inline-flex items-center gap-1.5 text-[12.5px] text-muted">
      <Check className="size-3.5 text-accent" />
      Generado {formatRelative(job.finishedAt ?? job.createdAt)} · {job.costUsd.toFixed(3)} USD
    </p>
  );
}
