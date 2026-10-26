"use client";
import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Clock3 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { TranscriptRef } from "@/lib/notes/types";
import { formatClock } from "@/lib/time";

const REF_RE = /\[\[ref:(\d+)-(\d+)\]\]/g;

/**
 * Replace [[ref:a-b]] tokens with Markdown links to a `#ref-a-b` anchor so
 * the renderer can turn them into clickable time chips.
 */
export function prepareMarkdown(markdown: string, refs: readonly TranscriptRef[]): string {
  const byKey = new Map(refs.map((r) => [`${r.seqFrom}-${r.seqTo}`, r]));
  return markdown
    .replace(REF_RE, (_m, a: string, b: string) => {
      const r = byKey.get(`${a}-${b}`);
      // Tokens without a resolvable span are dropped rather than shown raw.
      return r ? `[${formatClock(r.startMs)}–${formatClock(r.endMs)}](#ref-${a}-${b})` : "";
    })
    .replace(/[ \t]+([.,;:!?])/g, "$1");
}

export interface MarkdownProps {
  markdown: string;
  refs?: readonly TranscriptRef[];
  onSeek?: (ms: number, ref: TranscriptRef) => void;
  className?: string;
}

export function Markdown({ markdown, refs = [], onSeek, className }: MarkdownProps) {
  const byKey = React.useMemo(() => new Map(refs.map((r) => [`${r.seqFrom}-${r.seqTo}`, r])), [refs]);
  const components = React.useMemo<Components>(
    () => ({
      a: ({ href, children, ...rest }) => {
        const m = /^#ref-(\d+)-(\d+)$/.exec(href ?? "");
        if (m) {
          const ref = byKey.get(`${m[1]}-${m[2]}`);
          return (
            <button
              type="button"
              onClick={() => ref && onSeek?.(ref.startMs, ref)}
              title={
                ref
                  ? `Basado en la explicación entre ${formatClock(ref.startMs, { forceHours: true })} y ${formatClock(ref.endMs, { forceHours: true })}`
                  : undefined
              }
              className="mx-0.5 inline-flex h-[1.35em] translate-y-[-1px] items-center gap-1 rounded-md border border-border bg-sunken px-1.5 align-middle font-mono text-[0.68em] font-medium text-muted no-underline transition-colors hover:border-accent hover:text-accent"
            >
              <Clock3 className="size-[0.9em]" />
              {children}
            </button>
          );
        }
        return (
          <a href={href} target="_blank" rel="noreferrer noopener" {...rest}>
            {children}
          </a>
        );
      },
      blockquote: ({ children }) => (
        <blockquote className="not-italic rounded-r-lg border-l-[3px] border-accent/50 bg-accent-soft/40 px-4 py-2 text-[0.95em] text-foreground [&_p]:mb-1 [&_strong]:text-accent-soft-foreground">
          {children}
        </blockquote>
      ),
      table: ({ children }) => (
        <div className="-mx-1 overflow-x-auto px-1">
          <table>{children}</table>
        </div>
      ),
    }),
    [byKey, onSeek],
  );
  return (
    <div className={cn("prose-study", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {prepareMarkdown(markdown, refs)}
      </ReactMarkdown>
    </div>
  );
}
