"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUp, BookOpen, Clock3, FileText, MessageSquare, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect, Textarea } from "@/components/ui/input";
import { Badge, Callout, Spinner } from "@/components/ui/misc";
import { api, errorMessage } from "@/lib/api/client";
import type { ChatCitation } from "@/lib/chat/answer";
import { cn } from "@/lib/cn";
import type { AssistantPayload } from "@/lib/data/chat";
import { LANGUAGE_LABEL } from "@/lib/notes/types";
import { Markdown } from "./markdown";
import type { NotesLanguage } from "./generation";

interface ConversationRow {
  id: string;
  title: string;
  updatedAt: number;
}
interface MessageRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  payload: AssistantPayload | null;
  createdAt: number;
}

const SUGGESTIONS = [
  "¿Qué parte de la clase era importante para el examen?",
  "Explícame mejor lo que dijo el profesor sobre el artículo 24.",
  "¿En qué momento habló de las excepciones?",
  "Hazme tres casos prácticos de lo que hemos visto.",
];

function CitationChip({
  c,
  onSeek,
  onOpenPage,
}: {
  c: ChatCitation;
  onSeek: (ms: number) => void;
  onOpenPage: (attachmentId: string, page: number) => void;
}) {
  const Icon = c.kind === "transcript" ? Clock3 : c.kind === "attachment" ? FileText : BookOpen;
  return (
    <button
      type="button"
      onClick={() => {
        if (c.kind === "transcript" && c.startMs !== undefined) onSeek(c.startMs);
        else if (c.kind === "attachment" && c.attachmentId && c.page) onOpenPage(c.attachmentId, c.page);
        else if (c.kind === "notes" && c.sectionKey)
          document.getElementById(`section-${c.sectionKey}`)?.scrollIntoView({ behavior: "smooth" });
      }}
      className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-sunken px-1.5 text-[11.5px] text-muted hover:border-accent hover:text-accent"
    >
      <Icon className="size-3" />
      {c.label}
    </button>
  );
}

function AssistantMessage({
  m,
  onSeek,
  onOpenPage,
  onAsk,
}: {
  m: MessageRow;
  onSeek: (ms: number) => void;
  onOpenPage: (a: string, p: number) => void;
  onAsk: (q: string) => void;
}) {
  const p = m.payload;
  if (!p) return <Markdown markdown={m.content} className="max-w-none text-[15px]" />;
  return (
    <div className="space-y-3">
      {p.grounded ? (
        <div>
          <p className="mb-1 inline-flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-[0.05em] text-accent">
            <BookOpen className="size-3.5" /> Basado en tu clase
          </p>
          <CitedMarkdown markdown={p.grounded} citations={p.citations} onSeek={onSeek} />
        </div>
      ) : null}
      {p.notInLecture && !p.grounded ? (
        <Callout tone="neutral" className="py-2 text-[13.5px]">
          Esto no se trató en la clase.
        </Callout>
      ) : null}
      {p.additional ? (
        <div className="rounded-xl border border-dashed border-border-strong px-4 py-3">
          <p className="mb-1 inline-flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-[0.05em] text-muted">
            <Sparkles className="size-3.5" /> Explicación adicional (no procede de la clase)
          </p>
          <CitedMarkdown markdown={p.additional} citations={p.citations} onSeek={onSeek} />
        </div>
      ) : null}
      {p.citations.length ? (
        <div className="flex flex-wrap gap-1.5">
          {p.citations.map((c, i) => (
            <CitationChip key={i} c={c} onSeek={onSeek} onOpenPage={onOpenPage} />
          ))}
        </div>
      ) : null}
      {p.followUps?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {p.followUps.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onAsk(f)}
              className="rounded-full border border-border px-3 py-1 text-[12.5px] text-muted transition hover:border-accent hover:text-accent"
            >
              {f}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Renders answer Markdown. Transcript citations become the same time chips
 * used in the notes; document and notes citations are shown inline by label
 * (and as clickable chips under the answer).
 */
function CitedMarkdown({
  markdown,
  citations,
  onSeek,
}: {
  markdown: string;
  citations: ChatCitation[];
  onSeek: (ms: number) => void;
}) {
  const refs = citations
    .filter(
      (c) =>
        c.kind === "transcript" &&
        c.startMs !== undefined &&
        c.endMs !== undefined &&
        c.seqFrom !== undefined &&
        c.seqTo !== undefined,
    )
    .map((c) => ({ seqFrom: c.seqFrom!, seqTo: c.seqTo!, startMs: c.startMs!, endMs: c.endMs! }));
  const md = markdown.replace(/\[\[cite:(\d+)\]\]/g, (_m, n: string) => {
    const c = citations[Number(n)];
    if (!c) return "";
    if (c.kind === "transcript" && c.seqFrom !== undefined && c.seqTo !== undefined)
      return `[[ref:${c.seqFrom}-${c.seqTo}]]`;
    return ` (${c.label})`;
  });
  return <Markdown markdown={md} refs={refs} onSeek={(ms) => onSeek(ms)} className="max-w-none text-[15px]" />;
}

export function ChatTab({
  sessionId,
  onSeek,
  onOpenPage,
}: {
  sessionId: string;
  onSeek: (ms: number) => void;
  onOpenPage: (attachmentId: string, page: number) => void;
}) {
  const qc = useQueryClient();
  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const [language, setLanguage] = React.useState<NotesLanguage>("auto");
  const [draft, setDraft] = React.useState("");
  const [pending, setPending] = React.useState<string | null>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  const conversations = useQuery({
    queryKey: ["chat", sessionId],
    queryFn: async () =>
      (await api<{ conversations: ConversationRow[] }>(`/api/sessions/${sessionId}/chat`)).conversations,
  });
  const activeId = conversationId ?? conversations.data?.[0]?.id ?? null;
  const messages = useQuery({
    queryKey: ["chat", sessionId, activeId],
    queryFn: async () =>
      (await api<{ messages: MessageRow[] }>(`/api/sessions/${sessionId}/chat/${activeId}`)).messages,
    enabled: Boolean(activeId),
  });

  const ask = useMutation({
    mutationFn: (message: string) =>
      api<{ conversationId: string }>(`/api/sessions/${sessionId}/chat`, {
        body: { conversationId: activeId, message, language },
      }),
    onMutate: (message) => setPending(message),
    onSuccess: ({ conversationId: id }) => {
      setConversationId(id);
      void qc.invalidateQueries({ queryKey: ["chat", sessionId] });
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => setPending(null),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/sessions/${sessionId}/chat/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setConversationId(null);
      void qc.invalidateQueries({ queryKey: ["chat", sessionId] });
    },
  });

  const count = messages.data?.length ?? 0;
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [count, pending]);

  function submit(text: string) {
    const message = text.trim();
    if (!message || ask.isPending) return;
    setDraft("");
    ask.mutate(message);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_220px]">
      <div className="flex min-h-[60dvh] flex-col rounded-2xl border border-border bg-surface shadow-soft">
        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5 sm:px-6">
          {!activeId || (messages.data && messages.data.length === 0) ? (
            <div className="mx-auto max-w-md py-10 text-center">
              <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent">
                <MessageSquare className="size-5" />
              </div>
              <p className="text-[15px] font-medium">Pregunta sobre esta clase</p>
              <p className="mt-1 text-sm text-muted">
                Las respuestas distinguen lo que dijo el profesor (con el minuto) de las explicaciones adicionales.
              </p>
              <div className="mt-5 grid gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => submit(s)}
                    className="rounded-xl border border-border px-3 py-2 text-left text-[13.5px] transition hover:border-accent hover:bg-accent-soft/40"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {messages.data?.map((m) => (
            <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              {m.role === "user" ? (
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[15px] leading-relaxed text-accent-foreground">
                  {m.content}
                </div>
              ) : (
                <div className="max-w-full min-w-0 flex-1 rounded-2xl rounded-bl-md border border-border bg-background px-4 py-3">
                  <AssistantMessage m={m} onSeek={onSeek} onOpenPage={onOpenPage} onAsk={submit} />
                </div>
              )}
            </div>
          ))}
          {pending ? (
            <>
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[15px] text-accent-foreground">
                  {pending}
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted">
                <Spinner className="size-4" /> Buscando en la clase y redactando…
              </div>
            </>
          ) : null}
          <div ref={bottomRef} />
        </div>
        <form
          className="border-t border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit(draft);
          }}
        >
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(draft);
                }
              }}
              rows={1}
              placeholder="Escribe tu duda… (Enter para enviar, Mayús+Enter para nueva línea)"
              className="min-h-11 max-h-40 resize-none"
              aria-label="Pregunta"
            />
            <Button
              type="submit"
              variant="primary"
              size="icon"
              aria-label="Enviar"
              disabled={!draft.trim() || ask.isPending}
              className="h-11 w-11 shrink-0"
            >
              {ask.isPending ? <Spinner /> : <ArrowUp />}
            </Button>
          </div>
        </form>
      </div>
      <aside className="space-y-4">
        <div>
          <label htmlFor="chat-language" className="mb-1.5 block text-[12.5px] font-medium text-muted">
            Idioma de respuesta
          </label>
          <NativeSelect
            id="chat-language"
            value={language}
            onChange={(e) => setLanguage(e.target.value as NotesLanguage)}
            className="h-9 text-[13.5px]"
          >
            {(Object.keys(LANGUAGE_LABEL) as NotesLanguage[]).map((k) => (
              <option key={k} value={k}>
                {k === "auto" ? "Como la pregunta" : LANGUAGE_LABEL[k]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12.5px] font-medium text-muted">Conversaciones</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Nueva conversación"
              onClick={() => setConversationId(null)}
            >
              <Plus />
            </Button>
          </div>
          <ul className="space-y-0.5">
            {conversations.data?.map((c) => (
              <li key={c.id} className="group flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setConversationId(c.id)}
                  className={cn(
                    "min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-[13px] text-muted hover:bg-sunken hover:text-foreground",
                    activeId === c.id && "bg-sunken text-foreground",
                  )}
                >
                  {c.title || "Sin título"}
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="opacity-0 group-hover:opacity-100"
                  aria-label="Eliminar conversación"
                  onClick={() => remove.mutate(c.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        </div>
        <Badge tone="outline" className="whitespace-normal py-1 text-[11px] leading-snug">
          Cada respuesta busca primero en la transcripción, los apuntes y los documentos; el coste se registra en
          Ajustes.
        </Badge>
      </aside>
    </div>
  );
}
