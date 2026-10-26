"use client";
import * as React from "react";
import { Dialog as D, AlertDialog as AD } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

const overlay = "fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] data-[state=open]:animate-fade-in";
const panel =
  "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-surface p-6 shadow-pop data-[state=open]:animate-slide-up focus:outline-none max-h-[calc(100dvh-2rem)] overflow-y-auto";

export function DialogContent({
  className,
  children,
  title,
  description,
  ...props
}: React.ComponentProps<typeof D.Content> & { title: string; description?: React.ReactNode }) {
  return (
    <D.Portal>
      <D.Overlay className={overlay} />
      <D.Content className={cn(panel, className)} {...props}>
        <div className="mb-5 pr-8">
          <D.Title className="text-[17px] font-semibold tracking-[-0.01em]">{title}</D.Title>
          {description ? (
            <D.Description className="mt-1.5 text-sm leading-relaxed text-muted">{description}</D.Description>
          ) : (
            <D.Description className="sr-only">{title}</D.Description>
          )}
        </div>
        {children}
        <D.Close asChild>
          <Button variant="ghost" size="icon-sm" className="absolute right-4 top-4 text-muted" aria-label="Cerrar">
            <X />
          </Button>
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />;
}

/** Confirmation dialog for destructive or irreversible actions. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancelar",
  destructive,
  onConfirm,
  busy,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  busy?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <AD.Root open={open} onOpenChange={onOpenChange}>
      <AD.Portal>
        <AD.Overlay className={overlay} />
        <AD.Content className={cn(panel, "max-w-md")}>
          <AD.Title className="text-[17px] font-semibold tracking-[-0.01em]">{title}</AD.Title>
          <AD.Description asChild>
            <div className="mt-2 text-sm leading-relaxed text-muted">{description}</div>
          </AD.Description>
          {children}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AD.Cancel asChild>
              <Button variant="secondary" disabled={busy}>
                {cancelLabel}
              </Button>
            </AD.Cancel>
            <Button
              variant={destructive ? "danger" : "primary"}
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </AD.Content>
      </AD.Portal>
    </AD.Root>
  );
}
