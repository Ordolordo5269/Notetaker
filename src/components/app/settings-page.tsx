"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageContainer, PageHeader } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect, FieldHint } from "@/components/ui/input";
import { Callout, SectionHeading, Skeleton } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api/client";

interface ProfileResponse {
  user: { email: string; displayName: string | null };
  profile: {
    notesLanguage: "auto" | "es" | "en" | "bilingual";
    removeFillers: boolean;
    transcriptionDelay: "minimal" | "low" | "medium" | "high" | "xhigh";
    audioReviewEnabled: boolean;
    audioRetentionDays: number | null;
    monthlyBudgetUsd: number | null;
    jobBudgetUsd: number | null;
  };
  usage: { monthSpendUsd: number; monthly: number | null; perJob: number | null; pricingCheckedAt: string };
  models: Record<string, string>;
  openaiConfigured: boolean;
}

function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="grid gap-1 py-4 sm:grid-cols-[1fr_260px] sm:items-center sm:gap-6">
      <div>
        <Label htmlFor={htmlFor} className="mb-0 text-[14px]">
          {label}
        </Label>
        {hint ? <FieldHint className="mt-0.5">{hint}</FieldHint> : null}
      </div>
      <div>{children}</div>
    </div>
  );
}

export function SettingsPage() {
  const qc = useQueryClient();
  const { data, isPending } = useQuery({ queryKey: ["profile"], queryFn: () => api<ProfileResponse>("/api/profile") });
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api("/api/profile", { method: "PATCH", body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Ajustes guardados");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const p = data?.profile;

  function numberOrNull(v: string): number | null {
    const n = Number(v);
    return v.trim() === "" || !Number.isFinite(n) ? null : n;
  }

  return (
    <PageContainer>
      <PageHeader title="Ajustes" description={data ? data.user.email : undefined} />
      {!data?.openaiConfigured && data ? (
        <Callout tone="warning" className="mb-6" title="OpenAI no está configurado en el servidor">
          Falta la variable OPENAI_API_KEY. La grabación local funciona, pero no habrá transcripción ni apuntes hasta
          configurarla.
        </Callout>
      ) : null}

      <section className="mb-10">
        <SectionHeading title="Transcripción" />
        <div className="divide-y divide-border rounded-xl border border-border bg-surface px-4 shadow-soft">
          <Field
            label="Latencia de la transcripción en directo"
            hint="Más retardo da más contexto al modelo y suele mejorar la precisión."
            htmlFor="delay"
          >
            {isPending || !p ? (
              <Skeleton className="h-10" />
            ) : (
              <NativeSelect
                id="delay"
                value={p.transcriptionDelay}
                onChange={(e) => patch.mutate({ transcriptionDelay: e.target.value })}
              >
                <option value="minimal">Mínima</option>
                <option value="low">Baja</option>
                <option value="medium">Media (recomendada)</option>
                <option value="high">Alta</option>
                <option value="xhigh">Máxima precisión</option>
              </NativeSelect>
            )}
          </Field>
          <Field
            label="Vista limpia sin muletillas"
            hint="Solo afecta a la vista limpia. La transcripción original se conserva siempre."
          >
            {p ? (
              <Switch
                checked={p.removeFillers}
                onCheckedChange={(v) => patch.mutate({ removeFillers: v })}
                aria-label="Eliminar muletillas"
              />
            ) : (
              <Skeleton className="h-5 w-9" />
            )}
          </Field>
        </div>
      </section>

      <section className="mb-10">
        <SectionHeading title="Apuntes" />
        <div className="divide-y divide-border rounded-xl border border-border bg-surface px-4 shadow-soft">
          <Field
            label="Idioma de los apuntes por defecto"
            hint="Nunca modifica la transcripción guardada."
            htmlFor="notes-lang"
          >
            {p ? (
              <NativeSelect
                id="notes-lang"
                value={p.notesLanguage}
                onChange={(e) => patch.mutate({ notesLanguage: e.target.value })}
              >
                <option value="auto">Automático (idioma predominante de la clase)</option>
                <option value="es">Español</option>
                <option value="en">Inglés</option>
                <option value="bilingual">Bilingüe</option>
              </NativeSelect>
            ) : (
              <Skeleton className="h-10" />
            )}
          </Field>
        </div>
      </section>

      <section className="mb-10">
        <SectionHeading title="Audio" />
        <div className="divide-y divide-border rounded-xl border border-border bg-surface px-4 shadow-soft">
          <Field
            label="Retención del audio (días)"
            hint="Pasado este plazo se borra el audio de las clases terminadas; transcripción y apuntes se conservan. Vacío = conservar siempre."
            htmlFor="retention"
          >
            {p ? (
              <Input
                id="retention"
                type="number"
                min={1}
                max={3650}
                defaultValue={p.audioRetentionDays ?? ""}
                placeholder="Sin límite"
                onBlur={(e) => {
                  const v = numberOrNull(e.target.value);
                  if (v !== p.audioRetentionDays) patch.mutate({ audioRetentionDays: v });
                }}
              />
            ) : (
              <Skeleton className="h-10" />
            )}
          </Field>
          <Field
            label="Revisión del audio tras la clase"
            hint="Vuelve a transcribir toda la grabación con el modelo de archivos al terminar. Mejora los fragmentos dudosos, pero cuesta el doble."
          >
            {p ? (
              <Switch
                checked={p.audioReviewEnabled}
                onCheckedChange={(v) => patch.mutate({ audioReviewEnabled: v })}
                aria-label="Revisión de audio"
              />
            ) : (
              <Skeleton className="h-5 w-9" />
            )}
          </Field>
        </div>
      </section>

      <section className="mb-10">
        <SectionHeading
          title="Costes"
          description={
            data
              ? `Gasto estimado este mes: ${data.usage.monthSpendUsd.toFixed(2)} USD. Precios comprobados el ${data.usage.pricingCheckedAt}.`
              : undefined
          }
        />
        <div className="divide-y divide-border rounded-xl border border-border bg-surface px-4 shadow-soft">
          <Field
            label="Límite mensual (USD)"
            hint="Las operaciones que lo superarían se detienen antes de empezar."
            htmlFor="monthly"
          >
            {p ? (
              <Input
                id="monthly"
                type="number"
                min={0}
                step="0.5"
                defaultValue={p.monthlyBudgetUsd ?? ""}
                placeholder="Sin límite"
                onBlur={(e) => {
                  const v = numberOrNull(e.target.value);
                  if (v !== p.monthlyBudgetUsd) patch.mutate({ monthlyBudgetUsd: v });
                }}
              />
            ) : (
              <Skeleton className="h-10" />
            )}
          </Field>
          <Field label="Límite por tarea (USD)" hint="Por ejemplo, una generación de apuntes." htmlFor="perjob">
            {p ? (
              <Input
                id="perjob"
                type="number"
                min={0}
                step="0.1"
                defaultValue={p.jobBudgetUsd ?? ""}
                placeholder="Sin límite"
                onBlur={(e) => {
                  const v = numberOrNull(e.target.value);
                  if (v !== p.jobBudgetUsd) patch.mutate({ jobBudgetUsd: v });
                }}
              />
            ) : (
              <Skeleton className="h-10" />
            )}
          </Field>
        </div>
        {data ? (
          <p className="mt-3 text-[12.5px] leading-relaxed text-subtle">
            Modelos configurados: directo {data.models.live}, archivos {data.models.file}, apuntes {data.models.notes},
            tareas rápidas {data.models.fast}, chat {data.models.chat}. Los costes se calculan con la tabla de precios
            incluida en la aplicación y son orientativos.
          </p>
        ) : null}
      </section>

      <section>
        <SectionHeading title="Cuenta" />
        <div className="rounded-xl border border-border bg-surface px-4 py-4 shadow-soft">
          <p className="text-sm text-muted">
            Sesión iniciada como <span className="font-medium text-foreground">{data?.user.email ?? "…"}</span>.
          </p>
          <Button
            variant="secondary"
            className="mt-3"
            onClick={async () => {
              await api("/api/auth/logout", { method: "POST", body: {} });
              window.location.assign("/login");
            }}
          >
            Cerrar sesión
          </Button>
        </div>
      </section>
    </PageContainer>
  );
}
