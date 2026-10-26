import { SubjectDetail } from "@/components/app/subject-detail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SubjectDetail id={id} />;
}
