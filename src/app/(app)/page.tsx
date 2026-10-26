import { Dashboard } from "@/components/app/dashboard";
import { requirePageUser } from "@/lib/auth/current-user";

export default async function HomePage() {
  const user = await requirePageUser();
  return <Dashboard displayName={user.displayName} />;
}
