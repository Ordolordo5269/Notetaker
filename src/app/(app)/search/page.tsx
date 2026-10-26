import type { Metadata } from "next";
import { SearchPage } from "@/components/app/search-page";

export const metadata: Metadata = { title: "Buscar" };

export default function Page() {
  return <SearchPage />;
}
