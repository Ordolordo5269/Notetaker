import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AuthForm } from "@/components/app/auth-form";
import { getCurrentUser } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "Crear cuenta" };

export default async function SignupPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <Suspense>
      <AuthForm mode="signup" />
    </Suspense>
  );
}
