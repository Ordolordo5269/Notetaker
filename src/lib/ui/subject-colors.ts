import type { SubjectColor } from "@/lib/db/schema";

// Muted, print-friendly hues. Used as small identity dots, never as fills.
export const SUBJECT_COLOR_HEX: Record<SubjectColor, string> = {
  green: "#3f7a5f",
  blue: "#3d6a9e",
  amber: "#b07a1f",
  rose: "#b0505f",
  violet: "#6d5aa6",
  slate: "#5f6b72",
  teal: "#2f7f80",
  orange: "#b8642a",
};

export const SUBJECT_COLOR_LABEL: Record<SubjectColor, string> = {
  green: "Verde",
  blue: "Azul",
  amber: "Ámbar",
  rose: "Rosa",
  violet: "Violeta",
  slate: "Pizarra",
  teal: "Turquesa",
  orange: "Naranja",
};

export function subjectHex(color: string | null | undefined): string {
  return SUBJECT_COLOR_HEX[(color ?? "slate") as SubjectColor] ?? SUBJECT_COLOR_HEX.slate;
}
