"use client";
import * as React from "react";
import { AlertTriangle, Info } from "lucide-react";
import { Badge, Callout } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import type { DocumentSection, StudyDocumentContent, TranscriptRef } from "@/lib/notes/types";
import { LANGUAGE_LABEL } from "@/lib/notes/types";
import { describeRefs } from "@/lib/notes/transcript";
import { formatDateTime } from "@/lib/time";
import { Markdown } from "./markdown";

export function DocumentMeta({ content, extra }: { content: StudyDocumentContent; extra?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
      <Badge tone="outline">{LANGUAGE_LABEL[content.language]}</Badge>
      <span>{content.meta.wordCount.toLocaleString("es-ES")} palabras</span>
      <span>{content.sections.length} secciones</span>
      <span>Generado {formatDateTime(content.meta.generatedAt)}</span>
      {content.meta.model ? <span className="font-mono text-[11.5px]">{content.meta.model}</span> : null}
      {extra}
    </div>
  );
}

/** Table of contents + sections with traceability captions. */
export function DocumentView({
  content,
  onSeek,
  renderSectionActions,
  renderSection,
  className,
}: {
  content: StudyDocumentContent;
  onSeek?: (ms: number, ref: TranscriptRef) => void;
  renderSectionActions?: (section: DocumentSection) => React.ReactNode;
  /** Replace a whole section's body (e.g. with an editor). Return undefined to keep the default rendering. */
  renderSection?: (section: DocumentSection) => React.ReactNode | undefined;
  className?: string;
}) {
  const [active, setActive] = React.useState<string | null>(null);
  const refs = React.useRef(new Map<string, HTMLElement>());

  React.useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive((visible[0].target as HTMLElement).dataset.section ?? null);
      },
      { rootMargin: "-10% 0px -70% 0px" },
    );
    for (const el of refs.current.values()) obs.observe(el);
    return () => obs.disconnect();
  }, [content]);

  return (
    <div className={cn("grid gap-10 lg:grid-cols-[1fr_240px]", className)}>
      <article className="min-w-0">
        {content.meta.gaps.length ? (
          <Callout tone="warning" icon={<AlertTriangle />} title="Tramos sin transcripción" className="mb-6">
            <ul className="list-disc pl-4">
              {content.meta.gaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </Callout>
        ) : null}
        {content.meta.uncovered.length ? (
          <Callout
            tone="neutral"
            icon={<Info />}
            title="Puntos de la clase que la revisión no pudo ubicar"
            className="mb-6"
          >
            <ul className="list-disc pl-4">
              {content.meta.uncovered.slice(0, 12).map((u) => (
                <li key={u}>{u}</li>
              ))}
              {content.meta.uncovered.length > 12 ? <li>… y {content.meta.uncovered.length - 12} más</li> : null}
            </ul>
          </Callout>
        ) : null}
        {content.sections.map((s) => (
          <section
            key={s.id}
            id={`section-${s.id}`}
            data-section={s.id}
            ref={(el) => {
              if (el) refs.current.set(s.id, el);
              else refs.current.delete(s.id);
            }}
            className="scroll-mt-24 border-b border-border pb-8 pt-2 last:border-0"
          >
            {renderSection?.(s) ?? (
              <>
                <div className="group mb-2 flex items-start justify-between gap-3">
                  {s.level === 1 ? (
                    <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.015em]">{s.heading}</h2>
                  ) : (
                    <h3 className="text-[18px] font-semibold leading-tight tracking-[-0.01em]">{s.heading}</h3>
                  )}
                  {renderSectionActions ? <div className="shrink-0">{renderSectionActions(s)}</div> : null}
                </div>
                {s.refs.length ? (
                  <p className="mb-4 text-[12px] text-subtle">
                    Basado en la explicación entre {describeRefs(s.refs)}
                    {s.refs.length > 4 ? ` y ${s.refs.length - 4} tramos más` : ""}.
                    {s.edited ? " · Editado manualmente" : ""}
                  </p>
                ) : s.edited ? (
                  <p className="mb-4 text-[12px] text-subtle">Editado manualmente</p>
                ) : null}
                <Markdown markdown={s.markdown} refs={s.refs} onSeek={onSeek} />
                {s.ambiguities.length ? (
                  <Callout tone="neutral" icon={<Info />} title="Pasajes ambiguos en la grabación" className="mt-4">
                    <ul className="list-disc pl-4">
                      {s.ambiguities.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </Callout>
                ) : null}
              </>
            )}
          </section>
        ))}
      </article>
      <nav aria-label="Índice" className="hidden lg:block">
        <div className="sticky top-6 max-h-[calc(100dvh-3rem)] overflow-y-auto pr-2">
          <p className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.06em] text-subtle">Índice</p>
          <ol className="space-y-0.5 border-l border-border">
            {content.sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#section-${s.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    refs.current.get(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className={cn(
                    "-ml-px block border-l-2 border-transparent py-1 pr-2 text-[13px] leading-snug text-muted transition-colors hover:text-foreground",
                    s.level === 2 ? "pl-6" : "pl-3",
                    active === s.id && "border-accent text-foreground",
                  )}
                >
                  {s.heading}
                </a>
              </li>
            ))}
          </ol>
        </div>
      </nav>
    </div>
  );
}

/** Markdown export of a whole document. */
export function documentToMarkdown(
  content: StudyDocumentContent,
  meta: { subject?: string | null; date?: string },
): string {
  const lines = [`# ${content.title}`, ""];
  const metaLine = [meta.subject, meta.date, LANGUAGE_LABEL[content.language]].filter(Boolean).join(" · ");
  if (metaLine) lines.push(`_${metaLine}_`, "");
  lines.push("## Índice", "", ...content.sections.map((s) => `${s.level === 2 ? "  " : ""}- ${s.heading}`), "");
  for (const s of content.sections) {
    lines.push(`${s.level === 1 ? "##" : "###"} ${s.heading}`, "");
    if (s.refs.length) lines.push(`_Basado en la explicación entre ${describeRefs(s.refs)}_`, "");
    lines.push(
      s.markdown.replace(/\[\[ref:(\d+)-(\d+)\]\]/g, (_m, a: string, b: string) => {
        const r = s.refs.find((x) => x.seqFrom === Number(a) && x.seqTo === Number(b));
        return r ? `(${describeRefs([r])})` : "";
      }),
      "",
    );
    if (s.ambiguities.length) lines.push("> Pasajes ambiguos: " + s.ambiguities.join(" · "), "");
  }
  return lines.join("\n").trimEnd() + "\n";
}
