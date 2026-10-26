"use client";
import * as React from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Spinner } from "@/components/ui/misc";
import { errorMessage } from "@/lib/api/client";

export interface ExportItem {
  label: string;
  run: () => Promise<void> | void;
}
export interface ExportGroup {
  label: string;
  items: ExportItem[];
}

/** Dropdown of export actions. PDF/DOCX are rendered on the device, so a spinner covers the wait. */
export function ExportMenu({
  groups,
  label = "Exportar",
  size = "md",
  variant = "secondary",
  align = "end",
}: {
  groups: ExportGroup[];
  label?: string;
  size?: "sm" | "md";
  variant?: "secondary" | "ghost";
  align?: "start" | "end";
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const visible = groups.filter((g) => g.items.length);
  if (!visible.length) return null;
  async function run(item: ExportItem) {
    setBusy(item.label);
    try {
      await item.run();
    } catch (err) {
      toast.error(`No se pudo exportar: ${errorMessage(err)}`);
    } finally {
      setBusy(null);
    }
  }
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant={variant} size={size} disabled={busy !== null} aria-label={label}>
          {busy ? <Spinner /> : <Download />}
          {busy ? "Generando…" : label}
        </Button>
      </MenuTrigger>
      <MenuContent align={align} className="min-w-56">
        {visible.map((g, gi) => (
          <React.Fragment key={g.label}>
            {gi > 0 ? <MenuSeparator /> : null}
            <MenuLabel>{g.label}</MenuLabel>
            {g.items.map((item) => (
              <MenuItem key={item.label} onSelect={() => void run(item)}>
                {item.label}
              </MenuItem>
            ))}
          </React.Fragment>
        ))}
      </MenuContent>
    </Menu>
  );
}
