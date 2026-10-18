import { useMemo, useState } from "react";
import { Dialog } from "../../components/ui/Dialog";
import { ApiError } from "../../platform/api/client";
import { posterUrl, usePick } from "./hooks";
import type { Collection, Entry } from "../../shared/types";

/** Choose this week's idea by hand instead of spinning. Uses the same weekly slot as a spin. */
export function PickDialog({
  open,
  onClose,
  collection,
  entries,
}: {
  open: boolean;
  onClose: () => void;
  collection: Collection;
  entries: Entry[];
}) {
  const pick = usePick(collection.id);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isMovie = collection.kind === "movies";

  const available = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => e.status === "available" && (!q || e.title.toLowerCase().includes(q)));
  }, [entries, query]);

  async function choose(e: Entry) {
    setError(null);
    try {
      await pick.mutateAsync(e.id);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't pick that one — try again.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Pick this week's ${isMovie ? "movie" : "date"}`}>
      <p className="text-sm text-muted mb-3">
        Choose one yourself instead of spinning. It counts as this week&apos;s pick, so there&apos;s no spinning after.
      </p>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search…"
        aria-label="Search ideas"
        className="w-full mb-3 rounded-md bg-panel-3 border border-line px-3 py-2 text-sm text-ink placeholder:text-muted"
      />
      {error && <p role="alert" className="mb-3 text-sm text-accent">{error}</p>}
      {available.length === 0 ? (
        <p className="text-sm text-muted text-center py-6">
          {entries.some((e) => e.status === "available") ? "Nothing matches that search." : "No ideas in the pool yet."}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {available.map((e) => (
            <li key={e.id}>
              <button
                onClick={() => choose(e)}
                disabled={pick.isPending}
                className="w-full flex items-center gap-3 rounded-lg bg-panel-2 border border-line px-3 py-2 text-left hover:border-accent transition disabled:opacity-50"
              >
                {isMovie && e.posterPath ? (
                  <img src={posterUrl(e.posterPath, "w92") ?? undefined} alt="" className="h-12 w-8 rounded object-cover" loading="lazy" />
                ) : (
                  <span className="h-12 w-8 grid place-items-center text-2xl">{e.emoji ?? (isMovie ? "🎬" : "🎲")}</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink truncate">{e.title}</span>
                  <span className="block u-label !text-[9px] truncate">
                    {e.contributorAvatar ?? "•"} {e.contributorName}
                    {isMovie && e.releaseYear ? ` · ${e.releaseYear}` : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
