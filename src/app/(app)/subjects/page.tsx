import type { Metadata } from "next";
import { SubjectsPage } from "@/components/app/subjects-page";

export const metadata: Metadata = { title: "Asignaturas" };

export default function Page() {
  return <SubjectsPage />;
}
