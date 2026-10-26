import Link from "next/link";
import { WifiOff } from "lucide-react";

export const metadata = { title: "Sin conexión" };

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-sunken text-muted">
          <WifiOff className="size-6" />
        </div>
        <h1 className="text-[20px] font-semibold tracking-[-0.01em]">Sin conexión</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          No se puede cargar esta página ahora mismo. Si estabas grabando, el audio sigue guardado en este dispositivo y
          se subirá al volver la conexión.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-foreground"
        >
          Reintentar
        </Link>
      </div>
    </main>
  );
}
