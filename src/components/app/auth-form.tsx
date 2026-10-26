"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldHint } from "@/components/ui/input";
import { Callout, Spinner } from "@/components/ui/misc";
import { api, errorMessage } from "@/lib/api/client";
import { Logo } from "./logo";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api(`/api/auth/${mode}`, {
        body: {
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? ""),
          ...(mode === "signup" ? { displayName: String(form.get("displayName") ?? "") || undefined } : {}),
        },
      });
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const isLogin = mode === "login";
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-[380px]">
        <Logo className="mb-10" />
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">
          {isLogin ? "Bienvenido de nuevo" : "Crea tu cuenta"}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          {isLogin
            ? "Tus clases, transcripciones y apuntes te esperan."
            : "Graba tus clases y conviértelas en apuntes fieles a lo explicado."}
        </p>
        <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
          {!isLogin ? (
            <div>
              <Label htmlFor="displayName">Nombre (opcional)</Label>
              <Input id="displayName" name="displayName" autoComplete="name" maxLength={120} />
            </div>
          ) : null}
          <div>
            <Label htmlFor="email">Correo electrónico</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required autoFocus inputMode="email" />
          </div>
          <div>
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={isLogin ? "current-password" : "new-password"}
              required
              minLength={isLogin ? undefined : 10}
            />
            {!isLogin ? <FieldHint>Mínimo 10 caracteres. Una frase larga es más segura.</FieldHint> : null}
          </div>
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
            {busy ? <Spinner /> : null}
            {isLogin ? "Entrar" : "Crear cuenta"}
          </Button>
        </form>
        <p className="mt-6 text-sm text-muted">
          {isLogin ? (
            <>
              ¿Primera vez aquí?{" "}
              <Link href="/signup" className="font-medium text-accent hover:underline">
                Crear cuenta
              </Link>
            </>
          ) : (
            <>
              ¿Ya tienes cuenta?{" "}
              <Link href="/login" className="font-medium text-accent hover:underline">
                Entrar
              </Link>
            </>
          )}
        </p>
        <p className="mt-10 text-xs leading-relaxed text-subtle">
          Tus grabaciones se guardan de forma privada. Consulta la{" "}
          <Link href="/privacy" className="underline underline-offset-2">
            política de privacidad
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
