import type { Metadata } from "next";
import { RecordingScreen } from "@/components/recording/recording-screen";

export const metadata: Metadata = { title: "Grabación" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RecordingScreen sessionId={id} />;
}
