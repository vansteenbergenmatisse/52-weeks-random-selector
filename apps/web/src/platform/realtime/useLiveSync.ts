import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Subscribe to the couple-scoped SSE stream and invalidate React Query caches
 * on any change, so both partners' screens update without a manual refresh.
 * Falls back silently if the stream drops (queries also poll on window focus).
 */
export function useLiveSync(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource("/api/events", { withCredentials: true });
    source.addEventListener("change", () => {
      qc.invalidateQueries();
    });
    source.onerror = () => {
      // EventSource auto-reconnects; nothing to do.
    };
    return () => source.close();
  }, [enabled, qc]);
}
