import { useEffect, useRef, useState } from "react";
import { api } from "../../platform/api/client";
import { posterUrl } from "../roulette/hooks";
import type { MovieResult } from "../../shared/types";

export interface ReviewRow {
  query: string; // original title from the spreadsheet
  description: string | null;
  year: number | null;
  choice: MovieResult | null; // the movie to import, or null = import as plain text
  included: boolean; // ticked = will be added when you click "Add selected"
}

/** One reviewable import row: tick to include, shows the suggested match, lets you correct it. */
export function ImportMovieRow({
  row,
  onChange,
  onToggle,
}: {
  row: ReviewRow;
  onChange: (choice: MovieResult | null) => void;
  onToggle: (included: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MovieResult[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!editing) return;
    const query = q.trim();
    if (!query) {
      setResults([]);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => void search(query), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, editing]);

  async function search(query: string) {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await api.get<{ results?: MovieResult[] }>(
        `/api/movies/search?q=${encodeURIComponent(query)}`,
        { signal: ac.signal },
      );
      if (ac.signal.aborted) return;
      setResults(r.results ?? []);
    } catch {
      /* ignore — leave prior results */
    } finally {
      if (abortRef.current === ac) setLoading(false);
    }
  }

  function openSearch() {
    setQ(row.choice?.title ?? row.query);
    setResults([]);
    setEditing(true);
  }

  function choose(m: MovieResult | null) {
    onChange(m);
    setEditing(false);
  }

  const { choice } = row;

  return (
    <div className={`rounded-md border border-line bg-panel-2 p-2 ${row.included ? "" : "opacity-45"}`}>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={row.included}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label={`Include ${row.query}`}
          className="h-4 w-4 shrink-0 accent-[var(--accent)] cursor-pointer"
        />
        <div className="h-14 w-10 shrink-0 grid place-items-center rounded bg-panel-3 overflow-hidden">
          {choice?.posterPath ? (
            <img src={posterUrl(choice.posterPath, "w92")!} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <span className="text-lg">{choice ? "🎬" : "📝"}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-muted truncate" title={row.query}>
            From sheet: <span className="text-faint">{row.query}</span>
          </p>
          {choice ? (
            <p className="text-sm text-ink truncate" title={choice.title}>
              {choice.title}
              {choice.releaseYear ? <span className="text-muted"> · {choice.releaseYear}</span> : ""}
              {choice.rating ? <span className="text-muted"> · ⭐ {choice.rating}</span> : ""}
            </p>
          ) : (
            <p className="text-sm text-muted italic">Import as text (no poster)</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={editing ? () => setEditing(false) : openSearch}
            className="text-xs px-2 py-1 rounded bg-panel-3 border border-line text-muted hover:text-ink hover:border-accent transition"
          >
            {editing ? "Close" : choice ? "Change" : "Find match"}
          </button>
          {choice && (
            <button
              type="button"
              onClick={() => choose(null)}
              className="text-xs px-2 py-1 rounded text-muted hover:text-ink"
              title="Import this row as plain text instead"
            >
              As text
            </button>
          )}
        </div>
      </div>

      {editing && (
        <div className="mt-2">
          <input
            className="field !py-1.5 text-sm"
            placeholder="Search a movie…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <div className="mt-1 max-h-40 overflow-y-auto space-y-1">
            {loading && results.length === 0 ? (
              <p className="text-center text-muted text-xs py-2">Searching…</p>
            ) : (
              results.slice(0, 8).map((m) => (
                <button
                  key={m.tmdbId}
                  type="button"
                  onClick={() => choose(m)}
                  className="w-full text-left flex items-center gap-2 rounded bg-panel-3 border border-line px-2 py-1 hover:border-accent transition"
                >
                  <div className="h-10 w-7 shrink-0 grid place-items-center rounded bg-panel-2 overflow-hidden">
                    {m.posterPath ? (
                      <img src={posterUrl(m.posterPath, "w92")!} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <span className="text-xs">🎬</span>
                    )}
                  </div>
                  <span className="min-w-0 flex-1 text-xs text-ink truncate">
                    {m.title}
                    {m.releaseYear ? <span className="text-muted"> · {m.releaseYear}</span> : ""}
                    {m.rating ? <span className="text-muted"> · ⭐ {m.rating}</span> : ""}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
