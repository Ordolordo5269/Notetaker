"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { LectureCard } from "@/lib/data/lectures";
import type { SubjectSummary } from "@/lib/data/subjects";

export interface DashboardData {
  subjects: SubjectSummary[];
  recent: LectureCard[];
  recoverable: LectureCard[];
  processing: LectureCard[];
  pendingNotes: LectureCard[];
  usage: { monthSpendUsd: number; monthlyBudgetUsd: number | null };
}

export const qk = {
  dashboard: ["dashboard"] as const,
  subjects: ["subjects"] as const,
  subject: (id: string) => ["subject", id] as const,
  lectures: (subjectId?: string | null) => ["lectures", subjectId ?? "all"] as const,
  lecture: (id: string) => ["lecture", id] as const,
  segments: (id: string) => ["segments", id] as const,
  markers: (id: string) => ["markers", id] as const,
  chunks: (id: string) => ["chunks", id] as const,
  documents: (id: string) => ["documents", id] as const,
  jobs: (id: string) => ["jobs", id] as const,
};

export function useDashboard() {
  return useQuery({ queryKey: qk.dashboard, queryFn: () => api<DashboardData>("/api/dashboard") });
}

export function useSubjects() {
  return useQuery({
    queryKey: qk.subjects,
    queryFn: async () => (await api<{ subjects: SubjectSummary[] }>("/api/subjects")).subjects,
  });
}

export function useLectures(subjectId?: string | null) {
  return useQuery({
    queryKey: qk.lectures(subjectId),
    queryFn: async () =>
      (await api<{ lectures: LectureCard[] }>(`/api/sessions${subjectId ? `?subjectId=${subjectId}` : ""}`)).lectures,
  });
}
