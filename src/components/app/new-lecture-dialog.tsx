"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { Callout, Spinner } from "@/components/ui/misc";
import { api, errorMessage } from "@/lib/api/client";
import { useSubjects } from "@/lib/hooks/queries";
import { SubjectDialog } from "./subject-dialog";

export function NewLectureDialog({
  open,
  onOpenChange,
  defaultSubjectId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultSubjectId?: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Nueva clase"
        description="No necesitas elegir idioma: se detecta español e inglés automáticamente."
      >
        {/* Mounted only while open, so form state resets on every open. */}
        <NewLectureForm defaultSubjectId={defaultSubjectId} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function NewLectureForm({
  defaultSubjectId,
  onOpenChange,
}: {
  defaultSubjectId?: string | null;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const subjects = useSubjects();
  const profile = useQuery({
    queryKey: ["profile"],
    queryFn: () => api<{ profile: { recordingNoticeAckAt: number | null } }>("/api/profile"),
  });
  const [subjectId, setSubjectId] = React.useState<string>(defaultSubjectId ?? "");
  const [ack, setAck] = React.useState(false);
  const [subjectOpen, setSubjectOpen] = React.useState(false);
  const needsAck = profile.data ? profile.data.profile.recordingNoticeAckAt === null : false;

  const create = useMutation({
    mutationFn: async (title: string) => {
      if (needsAck) await api("/api/profile", { method: "PATCH", body: { acknowledgeRecordingNotice: true } });
      return api<{ lecture: { id: string } }>("/api/sessions", { body: { title, subjectId: subjectId || null } });
    },
    onSuccess: ({ lecture }) => {
      onOpenChange(false);
      router.push(`/record/${lecture.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const title = String(new FormData(e.currentTarget).get("title") ?? "").trim();
    if (!title) return;
    create.mutate(title);
  }

  return (
    <>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label htmlFor="lecture-subject">Asignatura</Label>
          <div className="flex gap-2">
            <NativeSelect
              id="lecture-subject"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              disabled={subjects.isPending}
            >
              <option value="">Sin asignatura</option>
              {subjects.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
            <Button
              variant="secondary"
              size="icon"
              className="h-10 w-10"
              onClick={() => setSubjectOpen(true)}
              aria-label="Nueva asignatura"
              title="Nueva asignatura"
            >
              <Plus />
            </Button>
          </div>
        </div>
        <div>
          <Label htmlFor="lecture-title">Título de la clase</Label>
          <Input
            id="lecture-title"
            name="title"
            required
            maxLength={200}
            placeholder="Jurisdiction under Brussels I bis"
            autoFocus
          />
        </div>
        {needsAck ? (
          <Callout tone="neutral" icon={<ShieldCheck />} title="Antes de tu primera grabación">
            <p>
              Grabar una clase puede requerir el permiso del profesorado o estar regulado por tu universidad. StudyFlow
              no puede garantizar que una grabación sea lícita: compruébalo y obtén las autorizaciones necesarias.
            </p>
            <label className="mt-2 flex cursor-pointer items-start gap-2 text-foreground">
              <input
                type="checkbox"
                className="mt-1 accent-[var(--accent)]"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />
              <span>Entiendo que soy responsable de respetar las normas de grabación.</span>
            </label>
          </Callout>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={create.isPending || (needsAck && !ack)}>
            {create.isPending ? <Spinner /> : null}
            Continuar
          </Button>
        </DialogFooter>
      </form>
      <SubjectDialog open={subjectOpen} onOpenChange={setSubjectOpen} onSaved={(s) => setSubjectId(s.id)} />
    </>
  );
}
