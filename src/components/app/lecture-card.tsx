"use client";
import Link from "next/link";
import { AlertTriangle, Bookmark, FileText, HelpCircle, Mic, Star } from "lucide-react";
import { Badge } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import type { LectureCard as LectureCardData } from "@/lib/data/lectures";
import { isInterrupted, STATUS_LABELS } from "@/lib/sessions/state-machine";
import { formatDate, formatDuration } from "@/lib/time";
import { SubjectDot } from "./subject-dot";

const LANG_LABEL: Record<string, string> = { es: "ES", en: "EN" };

export function lectureHref(l: LectureCardData): string {
  if (l.status === "ready") return `/lectures/${l.id}`;
  return `/record/${l.id}`;
}

export function LectureStatusBadge({ lecture }: { lecture: LectureCardData }) {
  const interrupted = isInterrupted(lecture.status, lecture.lastHeartbeatAt);
  if (lecture.status === "ready") {
    if (lecture.processingStatus === "queued" || lecture.processingStatus === "processing") {
      return <Badge tone="accent">Generando apuntes</Badge>;
    }
    if (lecture.processingStatus === "failed") return <Badge tone="danger">Error al generar</Badge>;
    return lecture.hasNotes ? (
      <Badge tone="accent">
        <FileText /> Apuntes
      </Badge>
    ) : (
      <Badge tone="outline">Sin apuntes</Badge>
    );
  }
  if (lecture.status === "recording" && !interrupted) {
    return (
      <Badge tone="danger">
        <span className="size-1.5 animate-pulse-dot rounded-full bg-recording" /> Grabando
      </Badge>
    );
  }
  if (interrupted || lecture.status === "failed" || lecture.status === "finalizing") {
    return (
      <Badge tone="warning">
        <AlertTriangle /> {lecture.status === "finalizing" ? "Pendiente de cerrar" : "Recuperable"}
      </Badge>
    );
  }
  return <Badge tone="neutral">{STATUS_LABELS[lecture.status]}</Badge>;
}

export function LectureCard({
  lecture,
  showSubject = true,
  className,
}: {
  lecture: LectureCardData;
  showSubject?: boolean;
  className?: string;
}) {
  const markers = lecture.importantCount + lecture.examCount + lecture.confusedCount;
  return (
    <Link
      href={lectureHref(lecture)}
      className={cn(
        "group block rounded-xl border border-border bg-surface p-4 shadow-soft transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-pop focus-visible:border-accent",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {showSubject ? (
            <p className="mb-1 flex items-center gap-1.5 text-[12.5px] text-muted">
              <SubjectDot color={lecture.subjectColor} />
              <span className="truncate">{lecture.subjectName ?? "Sin asignatura"}</span>
            </p>
          ) : null}
          <h3 className="truncate text-[15px] font-medium leading-snug tracking-[-0.005em]">{lecture.title}</h3>
        </div>
        <LectureStatusBadge lecture={lecture} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
        <span>{formatDate(lecture.startedAt ?? lecture.createdAt)}</span>
        {lecture.durationMs > 0 ? <span>{formatDuration(lecture.durationMs)}</span> : null}
        {lecture.languages.length ? (
          <span className="font-mono text-[11.5px] tracking-wide">
            {lecture.languages.map((l) => LANG_LABEL[l] ?? l).join(" · ")}
          </span>
        ) : null}
        {lecture.status === "ready" && lecture.segmentCount === 0 ? (
          <span className="inline-flex items-center gap-1 text-warning">
            <Mic /> sin transcripción
          </span>
        ) : null}
        {markers > 0 ? (
          <span className="ml-auto inline-flex items-center gap-2 [&_svg]:size-3.5">
            {lecture.importantCount ? (
              <span className="inline-flex items-center gap-0.5" title="Importante">
                <Star /> {lecture.importantCount}
              </span>
            ) : null}
            {lecture.examCount ? (
              <span className="inline-flex items-center gap-0.5" title="Posible examen">
                <Bookmark /> {lecture.examCount}
              </span>
            ) : null}
            {lecture.confusedCount ? (
              <span className="inline-flex items-center gap-0.5" title="No entendido">
                <HelpCircle /> {lecture.confusedCount}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

export function LectureCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="h-3 w-24 animate-pulse rounded bg-sunken" />
      <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-sunken" />
      <div className="mt-4 h-3 w-1/2 animate-pulse rounded bg-sunken" />
    </div>
  );
}
