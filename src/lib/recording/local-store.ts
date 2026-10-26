// IndexedDB persistence for recordings in progress. Everything the browser
// produces (audio chunks, transcript segments, markers, pending audio turns)
// lands here first; the sync queue uploads from here and marks rows as
// synced only after the server confirmed them.
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { MarkerType, SegmentLanguage, SegmentSource } from "@/lib/db/schema";

export interface LocalSessionState {
  sessionId: string;
  /** Active recording time persisted at the last checkpoint. */
  timelineMs: number;
  /** Next chunk sequence number. */
  nextChunkSeq: number;
  /** Next transcript turn sequence number. */
  nextTurnSeq: number;
  mime: string;
  transcriptionMode: "realtime" | "turns";
  /** Wall-clock time of the last checkpoint. */
  updatedAt: number;
  /** Whether the user finished the session locally (upload may still be pending). */
  finalized: boolean;
  /** Set when a recorder was interrupted and its parts were recovered. */
  recoveredAt?: number;
}

export interface LocalChunk {
  /** `${sessionId}:${seq}` */
  key: string;
  id: string;
  sessionId: string;
  seq: number;
  blob: Blob;
  mime: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  overlapMs: number;
  partial: boolean;
  sha256: string;
  synced: boolean;
  attempts: number;
  createdAt: number;
}

/** Timeslice part of a chunk whose recorder has not stopped yet. */
export interface LocalPart {
  key: string; // `${sessionId}:${seq}:${index}`
  sessionId: string;
  seq: number;
  index: number;
  chunkId: string;
  blob: Blob;
  mime: string;
  startMs: number;
  overlapMs: number;
  /** Timeline position when this part was received. */
  atMs: number;
}

export interface LocalSegment {
  key: string; // `${sessionId}:${seq}`
  sessionId: string;
  seq: number;
  text: string;
  status: "final" | "failed" | "gap";
  source: SegmentSource;
  startMs: number;
  endMs: number;
  providerItemId: string | null;
  language: SegmentLanguage;
  languageSource: "heuristic" | "model";
  synced: boolean;
  updatedAt: number;
}

export interface LocalMarker {
  id: string;
  sessionId: string;
  type: MarkerType;
  atMs: number;
  note: string | null;
  synced: boolean;
  deleted?: boolean;
  createdAt: number;
}

/** Audio of a turn that still needs transcribing (offline, WS down, failure). */
export interface PendingTurn {
  key: string; // `${sessionId}:${seq}`
  sessionId: string;
  seq: number;
  wav: Blob;
  startMs: number;
  endMs: number;
  source: "turns" | "recovery";
  attempts: number;
  createdAt: number;
}

interface StudyFlowDB extends DBSchema {
  sessions: { key: string; value: LocalSessionState };
  chunks: { key: string; value: LocalChunk; indexes: { bySession: string } };
  parts: { key: string; value: LocalPart; indexes: { bySession: string } };
  segments: { key: string; value: LocalSegment; indexes: { bySession: string } };
  markers: { key: string; value: LocalMarker; indexes: { bySession: string } };
  pendingTurns: { key: string; value: PendingTurn; indexes: { bySession: string } };
}

let dbPromise: Promise<IDBPDatabase<StudyFlowDB>> | null = null;

export function localDb(): Promise<IDBPDatabase<StudyFlowDB>> {
  if (!dbPromise) {
    dbPromise = openDB<StudyFlowDB>("studyflow", 1, {
      upgrade(db) {
        db.createObjectStore("sessions", { keyPath: "sessionId" });
        db.createObjectStore("chunks", { keyPath: "key" }).createIndex("bySession", "sessionId");
        db.createObjectStore("parts", { keyPath: "key" }).createIndex("bySession", "sessionId");
        db.createObjectStore("segments", { keyPath: "key" }).createIndex("bySession", "sessionId");
        db.createObjectStore("markers", { keyPath: "id" }).createIndex("bySession", "sessionId");
        db.createObjectStore("pendingTurns", { keyPath: "key" }).createIndex("bySession", "sessionId");
      },
    });
  }
  return dbPromise;
}

export const localStore = {
  async getSession(sessionId: string) {
    return (await localDb()).get("sessions", sessionId);
  },
  async putSession(state: LocalSessionState) {
    await (await localDb()).put("sessions", state);
  },
  async listSessions() {
    return (await localDb()).getAll("sessions");
  },

  async putChunk(chunk: LocalChunk) {
    await (await localDb()).put("chunks", chunk);
  },
  async listChunks(sessionId: string) {
    const rows = await (await localDb()).getAllFromIndex("chunks", "bySession", sessionId);
    return rows.sort((a, b) => a.seq - b.seq);
  },
  async markChunkSynced(key: string) {
    const db = await localDb();
    const tx = db.transaction("chunks", "readwrite");
    const row = await tx.store.get(key);
    if (row) await tx.store.put({ ...row, synced: true });
    await tx.done;
  },
  async bumpChunkAttempt(key: string) {
    const db = await localDb();
    const tx = db.transaction("chunks", "readwrite");
    const row = await tx.store.get(key);
    if (row) await tx.store.put({ ...row, attempts: row.attempts + 1 });
    await tx.done;
  },

  async putPart(part: LocalPart) {
    await (await localDb()).put("parts", part);
  },
  async listParts(sessionId: string, seq?: number) {
    const rows = await (await localDb()).getAllFromIndex("parts", "bySession", sessionId);
    return rows.filter((p) => seq === undefined || p.seq === seq).sort((a, b) => a.seq - b.seq || a.index - b.index);
  },
  async deleteParts(sessionId: string, seq: number) {
    const db = await localDb();
    const tx = db.transaction("parts", "readwrite");
    for (const p of await tx.store.index("bySession").getAll(sessionId)) {
      if (p.seq === seq) await tx.store.delete(p.key);
    }
    await tx.done;
  },

  async putSegment(seg: LocalSegment) {
    await (await localDb()).put("segments", seg);
  },
  async listSegments(sessionId: string) {
    const rows = await (await localDb()).getAllFromIndex("segments", "bySession", sessionId);
    return rows.sort((a, b) => a.startMs - b.startMs || a.seq - b.seq);
  },
  async markSegmentsSynced(sessionId: string, seqs: number[], updatedAtBefore: number) {
    const db = await localDb();
    const tx = db.transaction("segments", "readwrite");
    for (const seq of seqs) {
      const row = await tx.store.get(`${sessionId}:${seq}`);
      // Only mark synced if the row did not change after it was sent.
      if (row && row.updatedAt <= updatedAtBefore) await tx.store.put({ ...row, synced: true });
    }
    await tx.done;
  },

  async putMarker(m: LocalMarker) {
    await (await localDb()).put("markers", m);
  },
  async listMarkers(sessionId: string) {
    const rows = await (await localDb()).getAllFromIndex("markers", "bySession", sessionId);
    return rows.sort((a, b) => a.atMs - b.atMs);
  },
  async markMarkerSynced(id: string) {
    const db = await localDb();
    const tx = db.transaction("markers", "readwrite");
    const row = await tx.store.get(id);
    if (row) {
      if (row.deleted) await tx.store.delete(id);
      else await tx.store.put({ ...row, synced: true });
    }
    await tx.done;
  },

  async putPendingTurn(t: PendingTurn) {
    await (await localDb()).put("pendingTurns", t);
  },
  async listPendingTurns(sessionId: string) {
    const rows = await (await localDb()).getAllFromIndex("pendingTurns", "bySession", sessionId);
    return rows.sort((a, b) => a.seq - b.seq);
  },
  async deletePendingTurn(key: string) {
    await (await localDb()).delete("pendingTurns", key);
  },
  async bumpPendingTurn(key: string) {
    const db = await localDb();
    const tx = db.transaction("pendingTurns", "readwrite");
    const row = await tx.store.get(key);
    if (row) await tx.store.put({ ...row, attempts: row.attempts + 1 });
    await tx.done;
  },

  /** Remove everything stored locally for a session (after it is safely on the server). */
  async purgeSession(sessionId: string) {
    const db = await localDb();
    const tx = db.transaction(["sessions", "chunks", "parts", "segments", "markers", "pendingTurns"], "readwrite");
    await tx.objectStore("sessions").delete(sessionId);
    for (const store of ["chunks", "parts", "segments", "markers", "pendingTurns"] as const) {
      const os = tx.objectStore(store);
      for (const key of await os.index("bySession").getAllKeys(sessionId)) await os.delete(key);
    }
    await tx.done;
  },
};

export interface StorageHealth {
  supported: boolean;
  persisted: boolean | null;
  usageBytes: number | null;
  quotaBytes: number | null;
  /** Below this many free bytes the UI warns the user. */
  low: boolean;
}

const LOW_STORAGE_BYTES = 150 * 1024 * 1024;

export async function checkStorage(): Promise<StorageHealth> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return { supported: false, persisted: null, usageBytes: null, quotaBytes: null, low: false };
  }
  let persisted: boolean | null = null;
  try {
    persisted = (await navigator.storage.persisted?.()) ?? null;
    if (persisted === false && navigator.storage.persist) persisted = await navigator.storage.persist();
  } catch {
    persisted = null;
  }
  const est = await navigator.storage.estimate();
  const usage = est.usage ?? null;
  const quota = est.quota ?? null;
  const low = usage !== null && quota !== null ? quota - usage < LOW_STORAGE_BYTES : false;
  return { supported: true, persisted, usageBytes: usage, quotaBytes: quota, low };
}
