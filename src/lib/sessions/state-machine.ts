// Capture lifecycle of a lecture. Mirrors session_status_transitions in
// migrations/0001_init.sql; tests/unit/state-machine.test.ts keeps both in sync.
import type { SessionStatus } from "@/lib/db/schema";

export const SESSION_TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  created: ["recording", "failed"],
  recording: ["paused", "recovering", "finalizing", "failed"],
  paused: ["recording", "recovering", "finalizing", "failed"],
  recovering: ["recording", "finalizing", "failed"],
  finalizing: ["ready", "failed"],
  ready: [],
  failed: ["recovering", "finalizing"],
};

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return from === to || SESSION_TRANSITIONS[from].includes(to);
}

/** Statuses in which the capture is still open (audio may still arrive). */
export function isCaptureOpen(status: SessionStatus): boolean {
  return status === "created" || status === "recording" || status === "paused" || status === "recovering";
}

/** Heartbeat older than this while "recording" means the tab was closed or crashed. */
export const HEARTBEAT_STALE_MS = 90_000;

export function isInterrupted(status: SessionStatus, lastHeartbeatAt: number | null, now = Date.now()): boolean {
  if (status === "recovering") return true;
  if (status !== "recording" && status !== "paused") return false;
  return lastHeartbeatAt === null || now - lastHeartbeatAt > HEARTBEAT_STALE_MS;
}

export const STATUS_LABELS: Record<SessionStatus, string> = {
  created: "Preparada",
  recording: "Grabando",
  paused: "En pausa",
  recovering: "Recuperable",
  finalizing: "Finalizando",
  ready: "Grabación lista",
  failed: "Con errores",
};
