"use client";
import * as React from "react";
import Link from "next/link";
import { BookOpen, Plus } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/app/app-shell";
import { SubjectDialog } from "@/components/app/subject-dialog";
import { SubjectDot } from "@/components/app/subject-dot";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { useSubjects } from "@/lib/hooks/queries";
import { formatRelative } from "@/lib/time";

export function SubjectsPage() {
  const { data, isPending } = useSubjects();
  const [open, setOpen] = React.useState(false);
  return (
    <PageContainer>
      <PageHeader
        title="Asignaturas"
        description="Cada asignatura tiene su propia biblioteca de clases, apuntes y repaso."
        actions={
          <Button variant="primary" onClick={() => setOpen(true)}>
            <Plus /> Nueva asignatura
          </Button>
        }
      />
      {isPending ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="h-24 animate-pulse rounded-xl bg-sunken" />
          <div className="h-24 animate-pulse rounded-xl bg-sunken" />
        </div>
      ) : data?.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.map((s) => (
            <Link
              key={s.id}
              href={`/subjects/${s.id}`}
              className="rounded-xl border border-border bg-surface p-4 shadow-soft transition hover:border-border-strong hover:shadow-pop"
            >
              <div className="flex items-center gap-2.5">
                <SubjectDot color={s.color} className="size-2.5" />
                <h2 className="truncate text-[15px] font-medium">{s.name}</h2>
              </div>
              <p className="mt-2 text-[13px] text-muted">
                {s.lectureCount === 1 ? "1 clase" : `${s.lectureCount} clases`}
                {s.lastLectureAt ? ` · última ${formatRelative(s.lastLectureAt)}` : ""}
              </p>
              {s.keywords.length ? (
                <p className="mt-2 truncate text-[12px] text-subtle">{s.keywords.slice(0, 5).join(" · ")}</p>
              ) : null}
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<BookOpen />}
          title="Sin asignaturas todavía"
          description="Por ejemplo: Private International Law, International Humanitarian Law, Constitutional Law."
          action={
            <Button variant="primary" onClick={() => setOpen(true)}>
              <Plus /> Crear asignatura
            </Button>
          }
        />
      )}
      <SubjectDialog open={open} onOpenChange={setOpen} />
    </PageContainer>
  );
}
