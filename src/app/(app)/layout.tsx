import { AppShell } from "@/components/app/app-shell";
import { requirePageUser } from "@/lib/auth/current-user";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  return <AppShell user={{ email: user.email, displayName: user.displayName }}>{children}</AppShell>;
}
