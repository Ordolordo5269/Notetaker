"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Dialog as D } from "radix-ui";
import { BookOpen, Home, Layers, LogOut, Menu as MenuIcon, Mic, Search, Settings, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api/client";
import { useSubjects } from "@/lib/hooks/queries";
import { Logo } from "./logo";
import { SubjectDot } from "./subject-dot";
import { ThemeToggle } from "./theme-toggle";
import { NewLectureDialog } from "./new-lecture-dialog";

interface ShellUser {
  email: string;
  displayName: string | null;
}

function NavLink({
  href,
  icon,
  children,
  onNavigate,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] text-muted transition-colors hover:bg-sunken hover:text-foreground [&_svg]:size-4",
        active && "bg-sunken font-medium text-foreground",
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </Link>
  );
}

function SidebarContent({ user, onNavigate }: { user: ShellUser; onNavigate?: () => void }) {
  const router = useRouter();
  const subjects = useSubjects();
  const [newOpen, setNewOpen] = React.useState(false);

  async function logout() {
    await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center px-4">
        <Link href="/" onClick={onNavigate} aria-label="StudyFlow, inicio">
          <Logo />
        </Link>
      </div>
      <div className="px-3">
        <Button variant="primary" className="w-full justify-start" onClick={() => setNewOpen(true)}>
          <Mic />
          Nueva grabación
        </Button>
      </div>
      <nav className="mt-4 space-y-0.5 px-3" aria-label="Principal">
        <NavLink href="/" icon={<Home />} onNavigate={onNavigate}>
          Inicio
        </NavLink>
        <NavLink href="/search" icon={<Search />} onNavigate={onNavigate}>
          Buscar
        </NavLink>
        <NavLink href="/review" icon={<Layers />} onNavigate={onNavigate}>
          Repaso
        </NavLink>
        <NavLink href="/subjects" icon={<BookOpen />} onNavigate={onNavigate}>
          Asignaturas
        </NavLink>
      </nav>
      <div className="mt-6 min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <p className="px-2.5 pb-1.5 text-[11.5px] font-medium uppercase tracking-[0.06em] text-subtle">Asignaturas</p>
        {subjects.isPending ? (
          <div className="space-y-2 px-2.5 pt-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24" />
          </div>
        ) : subjects.data?.length ? (
          <div className="space-y-0.5">
            {subjects.data.map((s) => (
              <NavLink
                key={s.id}
                href={`/subjects/${s.id}`}
                icon={<SubjectDot color={s.color} className="mx-1" />}
                onNavigate={onNavigate}
              >
                {s.name}
              </NavLink>
            ))}
          </div>
        ) : (
          <Link
            href="/subjects"
            onClick={onNavigate}
            className="block px-2.5 text-[13px] text-muted hover:text-foreground"
          >
            Crea tu primera asignatura
          </Link>
        )}
      </div>
      <div className="border-t border-border p-3">
        <NavLink href="/settings" icon={<Settings />} onNavigate={onNavigate}>
          Ajustes
        </NavLink>
        <div className="mt-2 flex items-center gap-2 px-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{user.displayName || user.email.split("@")[0]}</p>
            <p className="truncate text-[11.5px] text-muted">{user.email}</p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={logout} aria-label="Cerrar sesión" title="Cerrar sesión">
            <LogOut />
          </Button>
        </div>
        <ThemeToggle className="mx-2.5 mt-3" />
      </div>
      <NewLectureDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}

export function AppShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  return (
    <div className="flex min-h-dvh">
      <aside
        aria-label="Barra lateral"
        className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r border-border bg-background lg:block"
      >
        <SidebarContent user={user} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/90 px-4 backdrop-blur lg:hidden">
          <D.Root open={mobileOpen} onOpenChange={setMobileOpen}>
            <D.Trigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Abrir menú">
                <MenuIcon />
              </Button>
            </D.Trigger>
            <D.Portal>
              <D.Overlay className="fixed inset-0 z-40 bg-black/30 data-[state=open]:animate-fade-in" />
              <D.Content className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] border-r border-border bg-background shadow-pop data-[state=open]:animate-slide-up">
                <D.Title className="sr-only">Navegación</D.Title>
                <D.Description className="sr-only">Menú principal</D.Description>
                <D.Close asChild>
                  <Button variant="ghost" size="icon-sm" className="absolute right-3 top-3" aria-label="Cerrar menú">
                    <X />
                  </Button>
                </D.Close>
                <SidebarContent user={user} onNavigate={() => setMobileOpen(false)} />
              </D.Content>
            </D.Portal>
          </D.Root>
          <Link href="/" aria-label="StudyFlow, inicio">
            <Logo />
          </Link>
        </header>
        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}

export function PageContainer({
  children,
  className,
  wide,
}: {
  children: React.ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 pb-16 pt-6 sm:px-6 lg:px-10 lg:pt-10",
        wide ? "max-w-6xl" : "max-w-5xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
}: {
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1.5 text-[13px] text-muted">{eyebrow}</div> : null}
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] sm:text-[28px]">{title}</h1>
        {description ? <p className="mt-1.5 text-[15px] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
