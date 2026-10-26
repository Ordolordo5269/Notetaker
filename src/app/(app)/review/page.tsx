import type { Metadata } from "next";
import { ReviewPage } from "@/components/study/review-page";

export const metadata: Metadata = { title: "Repaso" };

export default function Page() {
  return <ReviewPage />;
}
