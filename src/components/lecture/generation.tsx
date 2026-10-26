"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, NativeSelect } from "@/components/ui/input";
import { Callout, Spinner } from "@/components/ui/misc";
import { api, ApiError, errorMessage } from "@/lib/api/client";
import { qk } from "@/lib/hooks/queries";
import type { JobRequest } from "@/lib/jobs/requests";
import type { CostEstimate } from "@/lib/notes/estimate";
import { LANGUAGE_LABEL } from "@/lib/notes/types";

export type NotesLanguage = "auto" | "es" | "en" | "bilingual";

export function useDefaultLanguage(): NotesLanguage {
  const profile = useQuery({
    queryKey: ["profile"],
    queryFn: () => api<{ profile: { notesLanguage: NotesLanguage } }>("/api/profile"),
  });
  return profile.data?.profile.notesLanguage ?? "auto";
}

export function LanguageSelect({
  value,
  onChange,
  id = "notes-language",
}: {
  value: NotesLanguage;
  onChange: (v: NotesLanguage) => void;
  id?: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>Idioma del material</Label>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value as NotesLanguage)}>
        {(Object.keys(LANGUAGE_LABEL) as NotesLanguage[]).map((k) => (
          <option key={k} value={k}>
            {LANGUAGE_LABEL[k]}
            {k === "auto" ? " (idioma predominante de la clase)" : ""}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

interface EstimateResponse {
  estimate: CostEstimate & { transcriptSegments: number; hasNotes: boolean };
  budget: { monthly: number | null; perJob: number | null; monthSpendUsd: number };
}

export function useEstimate(sessionId: string, request: JobRequest | null) {
  const key = JSON.stringify(request);
  return useQuery({
    queryKey: ["estimate", sessionId, key],
    queryFn: () => api<EstimateResponse>(`/api/sessions/${sessionId}/jobs/estimate`, { body: request }),
    enabled: request !== null,
    staleTime: 60_000,
    retry: false,
  });
}

export function EstimateLine({ sessionId, request }: { sessionId: string; request: JobRequest | null }) {
  const est = useEstimate(sessionId, request);
  if (!request) return null;
  if (est.isPending) {
    return (
      <p className="inline-flex items-center gap-1.5 text-[12.5px] text-muted">
        <Spinner className="size-3" /> Calculando coste estimado…
      </p>
    );
  }
  if (est.isError) {
    return (
      <p className="inline-flex items-center gap-1.5 text-[12.5px] text-warning">
        <AlertTriangle className="size-3.5" /> {errorMessage(est.error)}
      </p>
    );
  }
  const { estimate, budget } = est.data;
  const overJob = budget.perJob !== null && estimate.usd > budget.perJob;
  const overMonth = budget.monthly !== null && budget.monthSpendUsd + estimate.usd > budget.monthly;
  return (
    <div className="text-[12.5px] leading-relaxed text-muted">
      <p>
        Coste estimado: <span className="font-medium text-foreground">≈ {estimate.usd.toFixed(2)} USD</span>
        {" · "}
        {estimate.breakdown.map((b) => `${b.label} ${b.usd.toFixed(2)}`).join(" · ")}
      </p>
      {overJob || overMonth ? (
        <p className="mt-1 text-warning">
          Supera tu límite {overJob ? "por tarea" : "mensual"} configurado en Ajustes; la generación se rechazará.
        </p>
      ) : null}
    </div>
  );
}

/** Button that launches a job and reports the result. */
export function LaunchJobButton({
  sessionId,
  request,
  label,
  disabled,
  variant = "primary",
}: {
  sessionId: string;
  request: JobRequest | null;
  label: string;
  disabled?: boolean;
  variant?: "primary" | "secondary";
}) {
  const qc = useQueryClient();
  const [confirmOverwrite, setConfirmOverwrite] = React.useState(false);
  const launch = useMutation({
    mutationFn: (force: boolean) =>
      api<{ created: boolean }>(`/api/sessions/${sessionId}/jobs${force ? "?confirmOverwrite=1" : ""}`, {
        body: request,
      }),
    onSuccess: ({ created }) => {
      setConfirmOverwrite(false);
      void qc.invalidateQueries({ queryKey: qk.jobs(sessionId) });
      void qc.invalidateQueries({ queryKey: qk.lecture(sessionId) });
      toast.success(created ? "Trabajo iniciado" : "Ya había un trabajo en curso; se muestra su progreso.");
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "user_edits_present") {
        setConfirmOverwrite(true);
        return;
      }
      toast.error(errorMessage(e));
    },
  });
  return (
    <div className="space-y-3">
      {confirmOverwrite ? (
        <Callout tone="warning" icon={<AlertTriangle />} title="Los apuntes actuales tienen cambios manuales">
          Regenerar crea una versión nueva generada por la IA. Tu versión editada no se pierde: queda en el historial y
          podrás restaurarla.
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="primary" onClick={() => launch.mutate(true)} disabled={launch.isPending}>
              Regenerar de todos modos
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmOverwrite(false)}>
              Cancelar
            </Button>
          </div>
        </Callout>
      ) : (
        <Button
          variant={variant}
          size="lg"
          disabled={disabled || !request || launch.isPending}
          onClick={() => launch.mutate(false)}
        >
          {launch.isPending ? <Spinner /> : <Sparkles />}
          {label}
        </Button>
      )}
    </div>
  );
}
