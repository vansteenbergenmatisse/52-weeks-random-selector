import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../../platform/api/client";
import type { PlaceCategory, PlaceResult } from "../../shared/types";

interface SearchResponse {
  enabled?: boolean;
  area?: string | null;
  results?: PlaceResult[];
  note?: string;
}

/**
 * Live activity finder for date ideas. Type an area ("Manhattan"), pick a
 * category, and get real nearby places from OpenStreetMap — search runs
 * automatically as you type (debounced), like Netflix. Picking one fills the
 * idea's title + location.
 */
export function PlaceFinder({ onPick }: { onPick: (p: PlaceResult) => void }) {
  const [categories, setCategories] = useState<PlaceCategory[]>([]);
  const [category, setCategory] = useState<string>("");
  const [area, setArea] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [resolvedArea, setResolvedArea] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    api
      .get<{ categories: PlaceCategory[] }>("/api/places/categories")
      .then((r) => {
        setCategories(r.categories ?? []);
        setCategory((prev) => prev || r.categories?.[0]?.key || "");
      })
      .catch(() => {});
  }, []);

  // Debounced live search whenever the area or category changes.
  useEffect(() => {
    const q = area.trim();
    if (!q || !category) {
      abortRef.current?.abort();
      setResults([]);
      setResolvedArea(null);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => void run(q, category), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area, category]);

  async function run(q: string, cat: string) {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setNote(null);
    try {
      const qs = new URLSearchParams({ area: q, category: cat });
      const r = await api.get<SearchResponse>(`/api/places/search?${qs.toString()}`, { signal: ac.signal });
      if (ac.signal.aborted) return;
      setResults(r.results ?? []);
      setResolvedArea(r.area ?? null);
      if (r.enabled === false) setNote(r.note ?? "Place search isn't available.");
      else if (!r.area) setNote(`Couldn't find "${q}" — try a city or neighbourhood.`);
      else if ((r.results ?? []).length === 0) setNote("No spots here for that category — try another.");
    } catch (e) {
      if (ac.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
      setNote(e instanceof ApiError ? e.message : "Place search failed.");
    } finally {
      if (abortRef.current === ac) setLoading(false);
    }
  }

  const chip = (active: boolean) =>
    `text-xs px-2.5 py-1 rounded-full whitespace-nowrap transition ${
      active ? "bg-accent text-header" : "bg-panel-2 border border-line text-muted hover:text-ink"
    }`;

  return (
    <div className="space-y-2">
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-muted">📍</span>
        <input
          className="field pl-9 pr-9"
          placeholder="Where? e.g. Manhattan, New York…"
          value={area}
          onChange={(e) => setArea(e.target.value)}
        />
        {area && (
          <button
            type="button"
            onClick={() => setArea("")}
            aria-label="Clear area"
            className="absolute inset-y-0 right-2 grid place-items-center text-muted hover:text-ink px-1"
          >
            ✕
          </button>
        )}
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {categories.map((c) => (
          <button key={c.key} type="button" onClick={() => setCategory(c.key)} className={chip(category === c.key)}>
            {c.label}
          </button>
        ))}
      </div>

      {resolvedArea && !note && <p className="text-faint text-xs truncate">Near {resolvedArea}</p>}
      {note && <p className="text-faint text-xs">{note}</p>}

      {area.trim() && (
        <div className="space-y-1 max-h-56 overflow-y-auto">
          {loading && results.length === 0 ? (
            <p className="text-center text-muted text-sm py-4">Searching…</p>
          ) : (
            results.map((p, i) => (
              <button
                key={`${p.lat},${p.lon},${i}`}
                type="button"
                onClick={() => onPick(p)}
                className="w-full text-left rounded-md bg-panel-2 border border-line px-3 py-2 hover:border-accent transition"
              >
                <p className="text-sm text-ink font-medium truncate">{p.name}</p>
                {p.address && <p className="text-xs text-muted truncate">{p.address}</p>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
