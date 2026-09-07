import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../platform/api/client";
import type {
  Collection,
  CurrentState,
  Entry,
  HistoryItem,
  Progress,
  WhatsAppStatus,
} from "../../shared/types";

export const TMDB_IMG = "https://image.tmdb.org/t/p";
export const posterUrl = (path: string | null, size = "w342") => (path ? `${TMDB_IMG}/${size}${path}` : null);

export function useCollections() {
  return useQuery({
    queryKey: ["collections"],
    queryFn: () => api.get<{ collections: Collection[] }>("/api/collections"),
  });
}

export function useEntries(collectionId: string | undefined) {
  return useQuery({
    queryKey: ["entries", collectionId],
    queryFn: () => api.get<{ entries: Entry[]; progress: Progress }>(`/api/collections/${collectionId}/entries`),
    enabled: !!collectionId,
  });
}

export function useResult(collectionId: string | undefined) {
  return useQuery({
    queryKey: ["result", collectionId],
    queryFn: () => api.get<{ state: CurrentState }>(`/api/collections/${collectionId}/result`),
    enabled: !!collectionId,
  });
}

export function useHistory(collectionId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["history", collectionId],
    queryFn: () => api.get<{ history: HistoryItem[] }>(`/api/collections/${collectionId}/history`),
    enabled: !!collectionId && enabled,
  });
}

export function useWhatsApp(enabled: boolean) {
  return useQuery({
    queryKey: ["whatsapp"],
    queryFn: () => api.get<WhatsAppStatus>("/api/whatsapp/status"),
    enabled,
    refetchInterval: enabled ? 4000 : false,
  });
}

export interface CalendarStatus {
  enabled: boolean;
  emails: string[];
  durationMins: number;
  resendReady: boolean;
  configured: boolean;
  note: string;
}

export function useCalendar(enabled: boolean) {
  return useQuery({
    queryKey: ["calendar"],
    queryFn: () => api.get<CalendarStatus>("/api/calendar/config"),
    enabled,
  });
}

export function useAddToCalendar(collectionId: string) {
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean; reason?: string }>(`/api/collections/${collectionId}/calendar`),
  });
}

export function useSpin(collectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ created: boolean; state: CurrentState }>(`/api/collections/${collectionId}/spin`),
    onSuccess: (data) => {
      // Seed the result cache synchronously with the server's freshly-drawn state
      // so the winner is available the instant the spin animation starts. Without
      // this, the invalidate-triggered refetch lands AFTER the reel begins, the
      // Carousel sees winner === null and bails, and the spin hangs forever on
      // "Choosing…". The invalidate below still refetches to reconcile.
      qc.setQueryData(["result", collectionId], { state: data.state });
      qc.invalidateQueries({ queryKey: ["result", collectionId] });
      qc.invalidateQueries({ queryKey: ["entries", collectionId] });
      qc.invalidateQueries({ queryKey: ["collections"] });
    },
  });
}

export interface BulkImportItem {
  title: string;
  description?: string | null;
  emoji?: string | null;
  location?: string | null;
  releaseYear?: number | null;
  tmdbId?: number | null;
  posterPath?: string | null;
  backdropPath?: string | null;
}

export function useBulkImport(collectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: BulkImportItem[]) =>
      api.post<{ count: number }>(`/api/collections/${collectionId}/entries/bulk`, { items }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entries", collectionId] });
      qc.invalidateQueries({ queryKey: ["collections"] });
    },
  });
}

export function useReroll(collectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (expectedRevision: number) =>
      api.post<{ replaced: boolean; reason?: string; state: CurrentState }>(
        `/api/collections/${collectionId}/reroll`,
        { expectedRevision },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["result", collectionId] });
      qc.invalidateQueries({ queryKey: ["entries", collectionId] });
    },
  });
}

export function useComplete(collectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/api/collections/${collectionId}/complete`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["result", collectionId] });
      qc.invalidateQueries({ queryKey: ["entries", collectionId] });
      qc.invalidateQueries({ queryKey: ["history", collectionId] });
    },
  });
}
