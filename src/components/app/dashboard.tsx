"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, Mic, Plus, RotateCcw, Sparkles } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/app/app-shell";
import { LectureCard, LectureCardSkeleton } from "@/components/app/lecture-card";
import { NewLectureDialog } from "@/components/app/new-lecture-dialog";
import { SubjectDialog } from "@/components/app/subject-dialog";
import { SubjectDot } from "@/components/app/subject-dot";
import { Button } from "@/components/ui/button";
import { Callout, EmptyState, SectionHeading } from "@/components/ui/misc";
import { useDashboard } from "@/lib/hooks/queries";
import { formatRelative } from "@/lib/time";

export function Dashboard({ displayName }: { displayName: string | null }) {
  const { data, isPending, error } = useDashboard();
  const [newOpen, setNewOpen] = React.useState(false);
  const [subjectOpen, setSubjectOpen] = React.useState(false);
  const hour = new Date().getHours();
  const greeting = hour < 13 ? "Buenos días" : hour < 20 ? "Buenas tardes" : "Buenas noches";

  return (
    <PageContainer wide>
      <PageHeader
        title={displayName ? `${greeting}, ${displayName.split(" ")[0]}` : greeting}
        description="Graba la clase y deja que StudyFlow escriba por ti."
        actions={
          <Button variant="primary" size="lg" onClick={() => setNewOpen(true)}>
            <Mic />
            Nueva grabación
          </Button>
        }
      />

      {error ? <Callout tone="danger">No se pudo cargar el panel. Comprueba tu conexión.</Callout> : null}

      {data?.recoverable.length ? (
        <section className="mb-8">
          <SectionHeading
            title="Sesiones recuperables"
            description="Grabaciones interrumpidas o pendientes de cerrar."
          />
          <div className="space-y-2">
            {data.recoverable.map((l) => (
              <Link
                key={l.id}
                href={`/record/${l.id}`}
                className="flex items-center gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm transition hover:border-warning/60"
              >
                <RotateCcw className="size-4 shrink-0 text-warning" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{l.title}</p>
                  <p className="text-[12.5px] text-muted">
                    {l.subjectName ?? "Sin asignatura"} · última actividad{" "}
                    {formatRelative(l.lastHeartbeatAt ?? l.createdAt)}
                  </p>
                </div>
                <span className="text-[13px] font-medium text-warning">Revisar</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {data?.pendingNotes.length ? (
        <section className="mb-8">
          <SectionHeading title="Pendientes de procesar" description="Clases grabadas que todavía no tienen apuntes." />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.pendingNotes.slice(0, 3).map((l) => (
              <Link
                key={l.id}
                href={`/lectures/${l.id}?tab=notes`}
                className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm shadow-soft transition hover:border-border-strong"
              >
                <Sparkles className="size-4 shrink-0 text-accent" />
                <span className="min-w-0 flex-1 truncate font-medium">{l.title}</span>
                <ArrowRight className="size-4 text-muted" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-[1fr_280px]">
        <section>
          <SectionHeading
            title="Clases recientes"
            action={
              data?.recent.length ? (
                <Button variant="link" size="sm" asChild>
                  <Link href="/subjects">Ver todas</Link>
                </Button>
              ) : null
            }
          />
          {isPending ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <LectureCardSkeleton />
              <LectureCardSkeleton />
              <LectureCardSkeleton />
            </div>
          ) : data?.recent.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {data.recent.map((l) => (
                <LectureCard key={l.id} lecture={l} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Mic />}
              title="Todavía no has grabado ninguna clase"
              description="Pulsa «Nueva grabación», elige asignatura y título, y empieza cuando hable el profesor."
              action={
                <Button variant="primary" onClick={() => setNewOpen(true)}>
                  <Mic /> Grabar la primera clase
                </Button>
              }
            />
          )}
        </section>

        <aside>
          <SectionHeading
            title="Asignaturas"
            action={
              <Button variant="ghost" size="icon-sm" aria-label="Nueva asignatura" onClick={() => setSubjectOpen(true)}>
                <Plus />
              </Button>
            }
          />
          {isPending ? (
            <div className="space-y-2">
              <div className="h-10 animate-pulse rounded-lg bg-sunken" />
              <div className="h-10 animate-pulse rounded-lg bg-sunken" />
            </div>
          ) : data?.subjects.length ? (
            <ul className="divide-y divide-border rounded-xl border border-border bg-surface shadow-soft">
              {data.subjects.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/subjects/${s.id}`}
                    className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm transition hover:bg-sunken"
                  >
                    <SubjectDot color={s.color} />
                    <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                    <span className="text-[12px] text-muted">{s.lectureCount}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<BookOpen />}
              title="Sin asignaturas"
              description="Organiza tus clases por asignatura."
              className="py-8"
              action={
                <Button variant="secondary" size="sm" onClick={() => setSubjectOpen(true)}>
                  <Plus /> Crear asignatura
                </Button>
              }
            />
          )}
          {data ? (
            <p className="mt-4 px-1 text-[12px] leading-relaxed text-subtle">
              Uso estimado este mes: {data.usage.monthSpendUsd.toFixed(2)} USD
              {data.usage.monthlyBudgetUsd !== null ? ` de ${data.usage.monthlyBudgetUsd.toFixed(2)} USD` : ""}.{" "}
              <Link href="/settings" className="underline underline-offset-2">
                Límites
              </Link>
            </p>
          ) : null}
        </aside>
      </div>

      <NewLectureDialog open={newOpen} onOpenChange={setNewOpen} />
      <SubjectDialog open={subjectOpen} onOpenChange={setSubjectOpen} />
    </PageContainer>
  );
}
