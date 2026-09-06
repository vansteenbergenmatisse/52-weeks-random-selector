import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../../platform/api/client";
import { posterUrl } from "../roulette/hooks";
import type { MovieGenre, MovieResult } from "../../shared/types";

type Mode = "top_rated" | "trending" | "popular";
const MODES: { key: Mode; label: string }[] = [
  { key: "top_rated", label: "⭐ Top rated" },
  { key: "trending", label: "🔥 Trending" },
  { key: "popular", label: "📈 Popular" },
];

interface Feed {
  enabled?: boolean;
  results?: MovieResult[];
  note?: string;
}

/** Netflix-style browse + search for adding a movie. Calls onPick with the chosen result. */
export function MoviePicker({ onPick }: { onPick: (m: MovieResult) => void }) {
  const [genres, setGenres] = useState<MovieGenre[]>([]);
  const [mode, setMode] = useState<Mode>("top_rated");
  const [genre, setGenre] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MovieResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const searchAbort = useRef<AbortController | null>(null);

  const searching = query.trim().length > 0;

  useEffect(() => {
    api
      .get<{ genres: MovieGenre[] }>("/api/movies/genres")
      .then((r) => setGenres(r.genres ?? []))
      .catch(() => {});
  }, []);

  // Browse feed — only while the search box is empty.
  useEffect(() => {
    if (searching) return; // live search results take over until the box is cleared
    void loadDiscover(mode, genre);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, genre, searching]);

  // Netflix-style live search: debounce keystrokes, cancel the previous
  // in-flight request so results can't arrive out of order.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      searchAbort.current?.abort();
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => void runSearch(q), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function loadDiscover(m: Mode, g: number | null) {
    setLoading(true);
    setNote(null);
    try {
      const qs = new URLSearchParams({ mode: m });
      if (g) qs.set("genre", String(g));
      const r = await api.get<Feed>(`/api/movies/discover?${qs.toString()}`);
      setResults(r.results ?? []);
      if (r.enabled === false) setNote(r.note ?? "Movie browsing isn't set up yet.");
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : "Couldn't load movies.");
    } finally {
      setLoading(false);
    }
  }

  async function runSearch(q: string) {
    searchAbort.current?.abort();
    const ac = new AbortController();
    searchAbort.current = ac;
    setNote(null);
    try {
      const r = await api.get<Feed>(`/api/movies/search?q=${encodeURIComponent(q)}`, { signal: ac.signal });
      if (ac.signal.aborted) return;
      setResults(r.results ?? []);
      if (r.enabled === false) setNote(r.note ?? "Search isn't set up yet.");
      else if ((r.results ?? []).length === 0) setNote("No matches — try another title.");
    } catch (e) {
      if (ac.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
      setNote(e instanceof ApiError ? e.message : "Search failed.");
    } finally {
      if (searchAbort.current === ac) setLoading(false);
    }
  }

  const chip = (active: boolean) =>
    `text-xs px-2.5 py-1 rounded-full whitespace-nowrap transition ${
      active ? "bg-accent text-header" : "bg-panel-2 border border-line text-muted hover:text-ink"
    }`;

  return (
    <div className="space-y-2">
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-muted">🔍</span>
        <input
          className="field pl-9 pr-9"
          placeholder="Search any movie…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        {searching && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute inset-y-0 right-2 grid place-items-center text-muted hover:text-ink px-1"
          >
            ✕
          </button>
        )}
      </div>

      {!searching && (
        <>
          <div className="flex gap-1.5">
            {MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                className={`text-xs px-2.5 py-1 rounded-md transition ${
                  mode === m.key ? "bg-accent text-header" : "bg-panel-3 text-muted hover:text-ink"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            <button onClick={() => setGenre(null)} className={chip(genre === null)}>
              All
            </button>
            {genres.map((g) => (
              <button key={g.id} onClick={() => setGenre(g.id)} className={chip(genre === g.id)}>
                {g.name}
              </button>
            ))}
          </div>
        </>
      )}

      {note && <p className="text-faint text-xs">{note}</p>}

      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-72 overflow-y-auto">
        {loading && results.length === 0 ? (
          <p className="col-span-full text-center text-muted text-sm py-6">Loading…</p>
        ) : (
          results.map((m) => (
            <button
              key={m.tmdbId}
              onClick={() => onPick(m)}
              className="text-left rounded-md bg-panel-2 border border-line overflow-hidden hover:border-accent transition"
              title={m.overview}
            >
              <div className="aspect-[2/3] bg-panel-3 grid place-items-center overflow-hidden">
                {m.posterPath ? (
                  <img src={posterUrl(m.posterPath, "w185")!} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <span className="text-2xl">🎬</span>
                )}
              </div>
              <div className="p-1">
                <p className="text-[11px] leading-tight text-ink line-clamp-2">{m.title}</p>
                <p className="text-[9px] text-muted mt-0.5">
                  {m.rating ? `⭐ ${m.rating}` : ""}
                  {m.rating && m.releaseYear ? " · " : ""}
                  {m.releaseYear ?? ""}
                </p>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
