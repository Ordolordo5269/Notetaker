"use client";
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea, FieldHint } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";
import { api, errorMessage } from "@/lib/api/client";
import { SUBJECT_COLORS, type SubjectColor } from "@/lib/db/schema";
import { SUBJECT_COLOR_HEX, SUBJECT_COLOR_LABEL } from "@/lib/ui/subject-colors";
import { qk } from "@/lib/hooks/queries";
import { cn } from "@/lib/cn";

export interface SubjectFormValue {
  id?: string;
  name: string;
  color: SubjectColor;
  keywords: string[];
  description: string | null;
}

export function SubjectDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: SubjectFormValue;
  onSaved?: (subject: { id: string; name: string }) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={initial?.id ? "Editar asignatura" : "Nueva asignatura"}
        description="Las palabras clave ayudan a reconocer términos técnicos. Nunca se insertan si no se pronuncian."
      >
        {/* Mounted only while open, so form state resets on every open. */}
        <SubjectForm initial={initial} onSaved={onSaved} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function SubjectForm({
  initial,
  onSaved,
  onOpenChange,
}: {
  initial?: SubjectFormValue;
  onSaved?: (subject: { id: string; name: string }) => void;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [color, setColor] = React.useState<SubjectColor>(initial?.color ?? "green");

  const save = useMutation({
    mutationFn: async (v: Omit<SubjectFormValue, "id">) =>
      initial?.id
        ? api<{ subject: { id: string; name: string } }>(`/api/subjects/${initial.id}`, { method: "PATCH", body: v })
        : api<{ subject: { id: string; name: string } }>("/api/subjects", { body: v }),
    onSuccess: ({ subject }) => {
      void qc.invalidateQueries({ queryKey: qk.subjects });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
      void qc.invalidateQueries({ queryKey: qk.subject(subject.id) });
      toast.success(initial?.id ? "Asignatura actualizada" : "Asignatura creada");
      onSaved?.(subject);
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save.mutate({
      name: String(f.get("name") ?? ""),
      color,
      keywords: String(f.get("keywords") ?? "")
        .split(/[,\n]/)
        .map((k) => k.trim())
        .filter(Boolean),
      description: String(f.get("description") ?? "") || null,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label htmlFor="subject-name">Nombre</Label>
        <Input
          id="subject-name"
          name="name"
          required
          maxLength={120}
          defaultValue={initial?.name}
          placeholder="Private International Law"
          autoFocus
        />
      </div>
      <div>
        <span className="mb-1.5 block text-[13px] font-medium">Color</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color">
          {SUBJECT_COLORS.map((c) => (
            <button
              type="button"
              key={c}
              role="radio"
              aria-checked={color === c}
              aria-label={SUBJECT_COLOR_LABEL[c]}
              title={SUBJECT_COLOR_LABEL[c]}
              onClick={() => setColor(c)}
              className={cn(
                "size-7 rounded-full border-2 border-transparent ring-offset-2 ring-offset-surface transition",
                color === c && "ring-2 ring-foreground/70",
              )}
              style={{ backgroundColor: SUBJECT_COLOR_HEX[c] }}
            />
          ))}
        </div>
      </div>
      <div>
        <Label htmlFor="subject-keywords">Palabras clave de transcripción</Label>
        <Textarea
          id="subject-keywords"
          name="keywords"
          rows={3}
          defaultValue={initial?.keywords.join(", ")}
          placeholder="Brussels I bis Regulation, Rome I Regulation, Reglamento Bruselas I bis, forum non conveniens"
        />
        <FieldHint>Separadas por comas. Nombres de normas, autores, siglas.</FieldHint>
      </div>
      <div>
        <Label htmlFor="subject-description">Descripción (opcional)</Label>
        <Input id="subject-description" name="description" maxLength={2000} defaultValue={initial?.description ?? ""} />
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {save.isPending ? <Spinner /> : null}
          Guardar
        </Button>
      </DialogFooter>
    </form>
  );
}
