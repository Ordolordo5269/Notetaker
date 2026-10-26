import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AuthForm } from "@/components/app/auth-form";
import { getCurrentUser } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <Suspense>
      <AuthForm mode="login" />
    </Suspense>
  );
}
