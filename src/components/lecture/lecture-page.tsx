"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bookmark,
  HelpCircle,
  Mic,
  MoreHorizontal,
  Pencil,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { PageContainer } from "@/components/app/app-shell";
import { SubjectDot } from "@/components/app/subject-dot";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Badge, Callout, EmptyState, Skeleton } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { TranscriptView, LanguageChip } from "@/components/recording/transcript-view";
import { api, errorMessage } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import type { LectureCard } from "@/lib/data/lectures";
import type { MarkerType, SegmentLanguage } from "@/lib/db/schema";
import { qk, useSubjects } from "@/lib/hooks/queries";
import type { TurnView } from "@/lib/recording/session-controller";
import {
  buildParagraphs,
  downloadText,
  safeFileName,
  transcriptToMarkdown,
  transcriptToText,
  type CleanableSegment,
} from "@/lib/transcription/clean";
import { exportAndDownload, studyDocToExport, transcriptToExport } from "@/lib/export";
import { formatClock, formatDate, formatDuration } from "@/lib/time";
import { ChatTab } from "./chat-tab";
import { documentToMarkdown } from "./document-view";
import { ExportMenu } from "./export-menu";
import { ChunkedPlayer, type ChunkMeta, type PlayerHandle } from "./chunked-player";
import { DocumentsTab } from "./documents-tab";
import { ExamTab } from "./exam-tab";
import { FlashcardsTab } from "./flashcards-tab";
import { lectureMeta, NotesTab, useDocuments } from "./notes-tab";
import { SummaryTab } from "./summary-tab";

export interface LectureDetail extends LectureCard {
  endedAt: number | null;
  keywords: string[];
  failureReason: string | null;
  audioMime: string | null;
}

interface SegmentRow {
  seq: number;
  text: string;
  status: "final" | "failed" | "gap";
  source: string;
  startMs: number;
  endMs: number;
  language: SegmentLanguage;
  languageSource: "heuristic" | "model";
}

interface MarkerRow {
  id: string;
  type: MarkerType;
  atMs: number;
  note: string | null;
}

const MARKER_META: Record<MarkerType, { label: string; icon: React.ReactNode }> = {
  important: { label: "Importante", icon: <Star /> },
  exam: { label: "Posible examen", icon: <Bookmark /> },
  confused: { label: "No entendido", icon: <HelpCircle /> },
  note: { label: "Nota", icon: <Pencil /> },
};

export function useLecture(id: string) {
  return useQuery({
    queryKey: qk.lecture(id),
    queryFn: async () => (await api<{ lecture: LectureDetail }>(`/api/sessions/${id}`)).lecture,
  });
}

export function LecturePage({ id }: { id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const lecture = useLecture(id);
  const segments = useQuery({
    queryKey: qk.segments(id),
    queryFn: async () => (await api<{ segments: SegmentRow[] }>(`/api/sessions/${id}/segments`)).segments,
  });
  const markers = useQuery({
    queryKey: qk.markers(id),
    queryFn: async () => (await api<{ markers: MarkerRow[] }>(`/api/sessions/${id}/markers`)).markers,
  });
  const chunks = useQuery({
    queryKey: qk.chunks(id),
    queryFn: async () => (await api<{ chunks: ChunkMeta[] }>(`/api/sessions/${id}/chunks`)).chunks,
  });
  const playerRef = React.useRef<PlayerHandle>(null);
  const [activeMs, setActiveMs] = React.useState(0);
  const [tab, setTab] = React.useState(params.get("tab") ?? "transcript");
  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  // Cross-tab hand-offs: a chat citation opens a document page; "Preguntar" on a page prefills the chat.
  const [focusPage, setFocusPage] = React.useState<{ attachmentId: string; page: number } | null>(null);
  const [chatPrefill, setChatPrefill] = React.useState<{ text: string; nonce: number } | null>(null);

  // Deep link from search: /lectures/:id?t=<ms>
  const initialSeek = React.useRef<number | null>(params.get("t") ? Number(params.get("t")) : null);
  React.useEffect(() => {
    if (initialSeek.current !== null && chunks.data) {
      const t = initialSeek.current;
      initialSeek.current = null;
      setActiveMs(t);
      setTimeout(() => playerRef.current?.seek(t, false), 50);
    }
  }, [chunks.data]);

  const remove = useMutation({
    mutationFn: () => api(`/api/sessions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.dashboard });
      void qc.invalidateQueries({ queryKey: ["lectures"] });
      toast.success("Clase eliminada");
      router.replace(lecture.data?.subjectId ? `/subjects/${lecture.data.subjectId}` : "/");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const seek = React.useCallback((ms: number) => {
    setActiveMs(ms);
    playerRef.current?.seek(ms, true);
  }, []);

  if (lecture.isError) {
    return (
      <PageContainer>
        <EmptyState
          title="Clase no encontrada"
          description="Puede que la hayas eliminado."
          action={
            <Button asChild>
              <Link href="/">Volver al inicio</Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }
  const l = lecture.data;
  if (l && l.status !== "ready") {
    router.replace(`/record/${id}`);
    return null;
  }

  return (
    <PageContainer wide className="pt-5 lg:pt-8">
      <header className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {l ? (
              <Link
                href={l.subjectId ? `/subjects/${l.subjectId}` : "/subjects"}
                className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground"
              >
                <SubjectDot color={l.subjectColor} /> {l.subjectName ?? "Sin asignatura"}
              </Link>
            ) : (
              <Skeleton className="h-4 w-32" />
            )}
            <h1 className="mt-1 text-[24px] font-semibold leading-tight tracking-[-0.02em] sm:text-[28px]">
              {l?.title ?? <Skeleton className="h-8 w-80" />}
            </h1>
            {l ? (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-muted">
                <span>{formatDate(l.startedAt ?? l.createdAt)}</span>
                <span>{formatDuration(l.durationMs)}</span>
                {l.languages.length ? (
                  <span className="font-mono text-[12px] tracking-wide">
                    {l.languages.map((x) => x.toUpperCase()).join(" · ")}
                  </span>
                ) : null}
                {l.transcriptionMode === "turns" ? (
                  <Tooltip content="La transcripción se hizo por turnos (sin conexión en directo).">
                    <span className="inline-flex items-center gap-1">
                      <Mic className="size-3.5" /> por turnos
                    </span>
                  </Tooltip>
                ) : null}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <LectureExportMenu lecture={l} segments={segments.data ?? []} sessionId={id} />
            <Menu>
              <MenuTrigger asChild>
                <Button variant="secondary" size="icon" aria-label="Más acciones">
                  <MoreHorizontal />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem onSelect={() => setEditOpen(true)}>
                  <Pencil /> Editar título o asignatura
                </MenuItem>
                <MenuSeparator />
                <MenuItem destructive onSelect={() => setDeleteOpen(true)}>
                  <Trash2 /> Eliminar clase
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </div>
        {l?.failureReason ? (
          <Callout tone="warning" icon={<AlertTriangle />} className="mt-4">
            {l.failureReason}
          </Callout>
        ) : null}
        <div className="mt-4">
          {chunks.data ? (
            <ChunkedPlayer
              ref={playerRef}
              sessionId={id}
              chunks={chunks.data}
              totalMs={l?.durationMs ?? 0}
              onTime={setActiveMs}
            />
          ) : (
            <Skeleton className="h-14 rounded-xl" />
          )}
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="transcript">Transcripción</TabsTrigger>
          <TabsTrigger value="notes">Apuntes</TabsTrigger>
          <TabsTrigger value="summary">Resumen</TabsTrigger>
          <TabsTrigger value="exam">Examen</TabsTrigger>
          <TabsTrigger value="flashcards">Flashcards</TabsTrigger>
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="documents">Documentos</TabsTrigger>
        </TabsList>
        <TabsContent value="flashcards" className="pt-5">
          <FlashcardsTab sessionId={id} onSeek={seek} />
        </TabsContent>
        <TabsContent value="chat" className="pt-5">
          <ChatTab
            sessionId={id}
            onSeek={seek}
            prefill={chatPrefill}
            onOpenPage={(attachmentId, page) => {
              setFocusPage({ attachmentId, page });
              setTab("documents");
            }}
          />
        </TabsContent>
        <TabsContent value="documents" className="pt-5">
          <DocumentsTab
            sessionId={id}
            focus={focusPage}
            onAskAboutPage={(question) => {
              setChatPrefill({ text: question, nonce: Date.now() });
              setTab("chat");
            }}
          />
        </TabsContent>
        <TabsContent value="notes" className="pt-5">
          <NotesTab sessionId={id} lecture={l} onSeek={seek} />
        </TabsContent>
        <TabsContent value="summary" className="pt-5">
          <SummaryTab sessionId={id} lecture={l} onSeek={seek} />
        </TabsContent>
        <TabsContent value="exam" className="pt-5">
          <ExamTab sessionId={id} onSeek={seek} />
        </TabsContent>
        <TabsContent value="transcript" className="pt-5">
          <TranscriptTab
            segments={segments.data}
            markers={markers.data ?? []}
            onSeek={seek}
            activeMs={activeMs}
            lecture={l}
          />
        </TabsContent>
      </Tabs>

      {l ? <EditLectureDialog open={editOpen} onOpenChange={setEditOpen} lecture={l} /> : null}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="¿Eliminar esta clase?"
        description="Se borrarán la grabación, la transcripción, los marcadores y los apuntes. Esta acción no se puede deshacer."
        confirmLabel="Eliminar clase"
        destructive
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </PageContainer>
  );
}

function toTurnViews(segments: SegmentRow[]): TurnView[] {
  return segments.map((s) => ({
    seq: s.seq,
    startMs: s.startMs,
    endMs: s.endMs,
    text: s.text,
    state: s.status === "gap" ? "gap" : s.status === "failed" ? "failed" : "final",
    language: s.language,
    languageSource: s.languageSource,
  }));
}

function TranscriptTab({
  segments,
  markers,
  onSeek,
  activeMs,
  lecture,
}: {
  segments: SegmentRow[] | undefined;
  markers: MarkerRow[];
  onSeek: (ms: number) => void;
  activeMs: number;
  lecture: LectureDetail | undefined;
}) {
  const [view, setView] = React.useState<"original" | "clean">("original");
  const [query, setQuery] = React.useState("");
  const profile = useQuery({
    queryKey: ["profile"],
    queryFn: () => api<{ profile: { removeFillers: boolean } }>("/api/profile"),
  });
  const removeFillers = profile.data?.profile.removeFillers ?? true;

  const q = query.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    if (!segments) return [];
    if (!q) return segments;
    const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const nq = norm(q);
    return segments.filter((s) => norm(s.text).includes(nq));
  }, [segments, q]);

  const paragraphs = React.useMemo(
    () => (view === "clean" && segments ? buildParagraphs(filtered as CleanableSegment[], { removeFillers }) : []),
    [view, segments, filtered, removeFillers],
  );

  if (!segments) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-5 w-4/5" />
      </div>
    );
  }
  const finalCount = segments.filter((s) => s.status === "final").length;
  if (finalCount === 0) {
    return (
      <EmptyState
        icon={<Mic />}
        title="Esta clase no tiene transcripción"
        description={
          lecture?.segmentCount === 0 && lecture.durationMs > 0
            ? "El audio se grabó, pero no se transcribió ningún fragmento (sin conexión o sin voz detectada)."
            : "No se detectó voz durante la grabación."
        }
      />
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Vista" className="flex rounded-lg bg-sunken p-0.5 text-[13px]">
            {(["original", "clean"] as const).map((v) => (
              <button
                key={v}
                role="radio"
                aria-checked={view === v}
                onClick={() => setView(v)}
                className={cn(
                  "h-7 rounded-md px-3 font-medium text-muted transition-colors",
                  view === v && "bg-surface text-foreground shadow-soft",
                )}
              >
                {v === "original" ? "Original" : "Limpia"}
              </button>
            ))}
          </div>
          <Tooltip
            content={
              view === "clean"
                ? "Párrafos por pausas y, si está activado en Ajustes, sin muletillas. Mismas palabras, mismo idioma."
                : "Fragmentos tal como se reconocieron, con su posición en el audio."
            }
          >
            <HelpCircle className="size-4 text-subtle" />
          </Tooltip>
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar en la transcripción"
              className="h-9 pl-8 text-[14px]"
              aria-label="Buscar en la transcripción"
            />
            {query ? (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-subtle hover:text-foreground"
                onClick={() => setQuery("")}
                aria-label="Limpiar búsqueda"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>
        {q && filtered.length === 0 ? <p className="text-sm text-muted">Sin coincidencias para «{query}».</p> : null}
        {view === "original" ? (
          <TranscriptView
            turns={toTurnViews(filtered)}
            follow={false}
            onSeek={onSeek}
            activeMs={activeMs}
            className="h-[min(70dvh,900px)] rounded-xl border border-border bg-surface py-2"
          />
        ) : (
          <div className="prose-study max-w-none">
            {paragraphs.map((p) =>
              p.gap ? (
                <p key={`gap-${p.seqFrom}`} className="my-3 text-[13px] text-warning">
                  {formatClock(p.startMs)} · {p.text}
                </p>
              ) : (
                <p
                  key={p.seqFrom}
                  className={cn(
                    "group",
                    activeMs >= p.startMs && activeMs < p.endMs && "rounded-md bg-accent-soft/50 px-1 -mx-1",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSeek(p.startMs)}
                    className="mr-2 align-baseline font-mono text-[12px] text-subtle hover:text-accent"
                    title="Reproducir desde aquí"
                  >
                    {formatClock(p.startMs)}
                  </button>
                  {p.text}
                  <LanguageChip language={p.language} source="heuristic" className="ml-1.5 align-middle" />
                </p>
              ),
            )}
          </div>
        )}
        <p className="mt-3 text-[12px] text-subtle">
          Las marcas de tiempo son aproximadas (por fragmento, no por palabra).{" "}
          {segments.some((s) => s.languageSource === "heuristic")
            ? "Las etiquetas de idioma con «~» son estimaciones a partir del texto."
            : ""}
        </p>
      </div>
      <aside>
        <h2 className="mb-2 text-[13px] font-medium uppercase tracking-[0.06em] text-subtle">Marcadores</h2>
        {markers.length === 0 ? (
          <p className="text-sm text-muted">No marcaste momentos durante la clase.</p>
        ) : (
          <ul className="space-y-1">
            {markers.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onSeek(m.atMs)}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-sunken [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted"
                >
                  {MARKER_META[m.type].icon}
                  <span className="min-w-0">
                    <span className="font-mono text-[12px] text-muted">{formatClock(m.atMs)}</span>
                    <span className="ml-1.5 font-medium">{MARKER_META[m.type].label}</span>
                    {m.note ? <span className="block text-[13px] text-muted">{m.note}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {lecture?.keywords.length ? (
          <>
            <h2 className="mb-2 mt-6 text-[13px] font-medium uppercase tracking-[0.06em] text-subtle">
              Palabras clave
            </h2>
            <div className="flex flex-wrap gap-1">
              {lecture.keywords.map((k) => (
                <Badge key={k} tone="outline">
                  {k}
                </Badge>
              ))}
            </div>
          </>
        ) : null}
      </aside>
    </div>
  );
}

function LectureExportMenu({
  lecture,
  segments,
  sessionId,
}: {
  lecture: LectureDetail | undefined;
  segments: SegmentRow[];
  sessionId: string;
}) {
  const docs = useDocuments(sessionId);
  if (!lecture) return null;
  const base = safeFileName(lecture.title);
  const meta = lectureMeta(lecture, lecture.title);
  const mdMeta = { subject: lecture.subjectName, date: meta.date, duration: meta.duration };
  const segs = segments as CleanableSegment[];
  const notes = docs.data?.find((d) => d.kind === "notes" && d.content)?.content;
  const md = "text/markdown;charset=utf-8";
  const transcriptItems = [
    {
      label: "PDF (limpia)",
      run: () =>
        exportAndDownload("pdf", transcriptToExport(meta, segs, { clean: true }), `${base}-transcripcion-limpia`),
    },
    {
      label: "Word (DOCX, limpia)",
      run: () =>
        exportAndDownload("docx", transcriptToExport(meta, segs, { clean: true }), `${base}-transcripcion-limpia`),
    },
    {
      label: "PDF (original)",
      run: () => exportAndDownload("pdf", transcriptToExport(meta, segs, { clean: false }), `${base}-transcripcion`),
    },
    {
      label: "Markdown (original)",
      run: () => downloadText(`${base}-transcripcion.md`, transcriptToMarkdown(lecture.title, mdMeta, segs), md),
    },
    {
      label: "Markdown (limpia)",
      run: () =>
        downloadText(
          `${base}-transcripcion-limpia.md`,
          transcriptToMarkdown(lecture.title, mdMeta, segs, { clean: true, removeFillers: true }),
          md,
        ),
    },
    {
      label: "Texto plano",
      run: () => downloadText(`${base}-transcripcion.txt`, transcriptToText(segs, { timestamps: true })),
    },
  ];
  const notesItems = notes
    ? [
        {
          label: "PDF",
          run: () =>
            exportAndDownload(
              "pdf",
              studyDocToExport(notes, meta, { kindLabel: "Apuntes completos" }),
              `${base}-apuntes`,
            ),
        },
        {
          label: "Word (DOCX)",
          run: () =>
            exportAndDownload(
              "docx",
              studyDocToExport(notes, meta, { kindLabel: "Apuntes completos" }),
              `${base}-apuntes`,
            ),
        },
        {
          label: "Markdown",
          run: () => downloadText(`${base}-apuntes.md`, documentToMarkdown(notes, mdMeta), md),
        },
      ]
    : [];
  return (
    <ExportMenu
      groups={[
        { label: "Apuntes", items: notesItems },
        { label: "Transcripción", items: transcriptItems },
      ]}
    />
  );
}

function EditLectureDialog({
  open,
  onOpenChange,
  lecture,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lecture: LectureDetail;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Editar clase">
        <EditLectureForm lecture={lecture} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function EditLectureForm({ lecture, onOpenChange }: { lecture: LectureDetail; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const subjects = useSubjects();
  const [subjectId, setSubjectId] = React.useState(lecture.subjectId ?? "");
  const save = useMutation({
    mutationFn: (body: { title: string; subjectId: string | null }) =>
      api(`/api/sessions/${lecture.id}`, { method: "PATCH", body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.lecture(lecture.id) });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
      void qc.invalidateQueries({ queryKey: ["lectures"] });
      void qc.invalidateQueries({ queryKey: qk.subjects });
      toast.success("Clase actualizada");
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const title = String(new FormData(e.currentTarget).get("title") ?? "").trim();
        if (title) save.mutate({ title, subjectId: subjectId || null });
      }}
    >
      <div>
        <Label htmlFor="edit-title">Título</Label>
        <Input id="edit-title" name="title" defaultValue={lecture.title} required maxLength={200} autoFocus />
      </div>
      <div>
        <Label htmlFor="edit-subject">Asignatura</Label>
        <NativeSelect id="edit-subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
          <option value="">Sin asignatura</option>
          {subjects.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          Guardar
        </Button>
      </DialogFooter>
    </form>
  );
}
