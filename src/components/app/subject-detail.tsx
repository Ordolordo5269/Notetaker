"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mic, MoreHorizontal, Pencil, Trash2, Upload } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/app/app-shell";
import { LectureCard, LectureCardSkeleton } from "@/components/app/lecture-card";
import { ImportAudioDialog } from "@/components/app/import-audio-dialog";
import { NewLectureDialog } from "@/components/app/new-lecture-dialog";
import { SubjectDialog } from "@/components/app/subject-dialog";
import { SubjectDot } from "@/components/app/subject-dot";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { EmptyState } from "@/components/ui/misc";
import { api, errorMessage } from "@/lib/api/client";
import type { SubjectColor } from "@/lib/db/schema";
import { qk, useLectures } from "@/lib/hooks/queries";

interface SubjectRow {
  id: string;
  name: string;
  color: SubjectColor;
  keywords: string[];
  description: string | null;
}

export function SubjectDetail({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const subject = useQuery({
    queryKey: qk.subject(id),
    queryFn: async () => (await api<{ subject: SubjectRow }>(`/api/subjects/${id}`)).subject,
  });
  const lectures = useLectures(id);
  const [editOpen, setEditOpen] = React.useState(false);
  const [newOpen, setNewOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const remove = useMutation({
    mutationFn: () => api(`/api/subjects/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.subjects });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
      toast.success("Asignatura eliminada. Las clases se conservan.");
      router.replace("/subjects");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (subject.isError) {
    return (
      <PageContainer>
        <EmptyState title="Asignatura no encontrada" description="Puede que la hayas eliminado." />
      </PageContainer>
    );
  }

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={
          subject.data ? (
            <span className="inline-flex items-center gap-1.5">
              <SubjectDot color={subject.data.color} /> Asignatura
            </span>
          ) : null
        }
        title={subject.data?.name ?? <span className="inline-block h-8 w-64 animate-pulse rounded bg-sunken" />}
        description={subject.data?.description ?? undefined}
        actions={
          <>
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              <Upload /> Importar audio
            </Button>
            <Button variant="primary" onClick={() => setNewOpen(true)}>
              <Mic /> Nueva clase
            </Button>
            <Menu>
              <MenuTrigger asChild>
                <Button variant="secondary" size="icon" aria-label="Más acciones">
                  <MoreHorizontal />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem onSelect={() => setEditOpen(true)}>
                  <Pencil /> Editar asignatura
                </MenuItem>
                <MenuSeparator />
                <MenuItem destructive onSelect={() => setDeleteOpen(true)}>
                  <Trash2 /> Eliminar asignatura
                </MenuItem>
              </MenuContent>
            </Menu>
          </>
        }
      />
      {lectures.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <LectureCardSkeleton />
          <LectureCardSkeleton />
          <LectureCardSkeleton />
        </div>
      ) : lectures.data?.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lectures.data.map((l) => (
            <LectureCard key={l.id} lecture={l} showSubject={false} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Mic />}
          title="Ninguna clase en esta asignatura"
          description="Cuando grabes la primera clase aparecerá aquí con su transcripción y apuntes."
          action={
            <Button variant="primary" onClick={() => setNewOpen(true)}>
              <Mic /> Grabar clase
            </Button>
          }
        />
      )}
      {subject.data ? <SubjectDialog open={editOpen} onOpenChange={setEditOpen} initial={subject.data} /> : null}
      <NewLectureDialog open={newOpen} onOpenChange={setNewOpen} defaultSubjectId={id} />
      <ImportAudioDialog open={importOpen} onOpenChange={setImportOpen} defaultSubjectId={id} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="¿Eliminar la asignatura?"
        description="Las clases, transcripciones y apuntes se conservan y pasan a «Sin asignatura»."
        confirmLabel="Eliminar"
        destructive
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </PageContainer>
  );
}
