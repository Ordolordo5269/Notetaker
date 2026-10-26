"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { FileText, Mic, Search } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/app/app-shell";
import { SubjectDot } from "@/components/app/subject-dot";
import { Input } from "@/components/ui/input";
import { EmptyState, Spinner } from "@/components/ui/misc";
import { api } from "@/lib/api/client";
import type { SearchHit } from "@/lib/data/search";
import { formatClock, formatDate } from "@/lib/time";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Snippet({ text }: { text: string }) {
  const parts = text.split(/\[\[|\]\]/);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-accent-soft px-0.5 text-foreground">
            {p}
          </mark>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        ),
      )}
    </>
  );
}

const KIND_LABEL: Record<SearchHit["kind"], string> = {
  lecture: "Clase",
  transcript: "Transcripción",
  document: "Apuntes",
};
const DOC_LABEL: Record<string, string> = {
  notes: "Apuntes",
  summary_quick: "Repaso rápido",
  summary_full: "Repaso completo",
  summary_last_minute: "Última hora",
};

export function SearchPage() {
  const [q, setQ] = React.useState("");
  const dq = useDebounced(q.trim(), 250);
  const { data, isFetching } = useQuery({
    queryKey: ["search", dq],
    queryFn: () => api<{ hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(dq)}`),
    enabled: dq.length >= 2,
    placeholderData: (prev) => prev,
  });
  return (
    <PageContainer>
      <PageHeader title="Buscar" description="Títulos, transcripciones y apuntes de todas tus clases." />
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Brussels I bis, competencia exclusiva, artículo 24…"
          className="h-12 pl-10 text-base"
          aria-label="Buscar"
        />
        {isFetching ? <Spinner className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted" /> : null}
      </div>
      <div className="mt-6">
        {dq.length < 2 ? (
          <p className="text-sm text-muted">Escribe al menos dos caracteres. La búsqueda ignora acentos.</p>
        ) : data && data.hits.length === 0 && !isFetching ? (
          <EmptyState
            icon={<Search />}
            title={`Sin resultados para «${dq}»`}
            description="Prueba con otra palabra o con un término más corto."
          />
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface shadow-soft">
            {data?.hits.map((h, i) => (
              <li key={`${h.kind}-${h.sessionId}-${h.seq ?? i}`}>
                <Link
                  href={
                    h.kind === "transcript" && h.startMs !== null
                      ? `/lectures/${h.sessionId}?tab=transcript&t=${h.startMs}`
                      : h.kind === "document"
                        ? `/lectures/${h.sessionId}?tab=${h.documentKind === "notes" ? "notes" : "summary"}`
                        : `/lectures/${h.sessionId}`
                  }
                  className="block px-4 py-3 transition hover:bg-sunken"
                >
                  <div className="flex items-center gap-2 text-[12.5px] text-muted">
                    {h.kind === "document" ? <FileText className="size-3.5" /> : <Mic className="size-3.5" />}
                    <span>
                      {h.kind === "document"
                        ? (DOC_LABEL[h.documentKind ?? ""] ?? KIND_LABEL.document)
                        : KIND_LABEL[h.kind]}
                    </span>
                    <span>·</span>
                    <SubjectDot color={h.subjectColor} />
                    <span className="truncate">{h.subjectName ?? "Sin asignatura"}</span>
                    <span>·</span>
                    <span>{formatDate(h.createdAt)}</span>
                    {h.startMs !== null ? <span className="ml-auto font-mono">{formatClock(h.startMs)}</span> : null}
                  </div>
                  <p className="mt-1 text-[14.5px] font-medium">{h.lectureTitle}</p>
                  {h.kind !== "lecture" ? (
                    <p className="mt-0.5 line-clamp-2 text-[14px] leading-relaxed text-muted">
                      <Snippet text={h.snippet} />
                    </p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageContainer>
  );
}
