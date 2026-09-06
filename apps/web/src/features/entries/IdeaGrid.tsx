import { posterUrl } from "../roulette/hooks";
import type { Collection, Entry } from "../../shared/types";

const CORNER: Record<string, string> = {
  red: "border-b-card-red",
  blue: "border-b-card-blue",
  purple: "border-b-card-purple",
  charcoal: "border-b-steel",
};

export function IdeaGrid({
  entries,
  collection,
  currentUserId,
  onEdit,
  onDelete,
}: {
  entries: Entry[];
  collection: Collection;
  currentUserId: string;
  onEdit: (e: Entry) => void;
  onDelete: (e: Entry) => void;
}) {
  const isMovie = collection.kind === "movies";
  const available = entries.filter((e) => e.status === "available");

  if (available.length === 0) {
    return (
      <div className="text-center py-10 text-muted">
        <p className="text-2xl mb-1">🫙</p>
        <p className="text-sm">No ideas in the pool yet. Add a few to start spinning.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7 gap-2.5">
      {available.map((e) => {
        const mine = e.contributorId === currentUserId;
        return (
          <div
            key={e.id}
            className={`group relative rounded-lg bg-panel-2 border border-line overflow-hidden hover:border-muted transition ${CORNER[collection.colorKey]} border-b-2`}
          >
            <div className="aspect-[3/4] grid place-items-center bg-panel-3 overflow-hidden">
              {isMovie && e.posterPath ? (
                <img src={posterUrl(e.posterPath, "w185")!} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <span className="text-4xl">{e.emoji ?? (isMovie ? "🎬" : "🎲")}</span>
              )}
            </div>
            <div className="p-1.5">
              <p className="text-[11px] leading-tight text-ink line-clamp-2 font-medium">{e.title}</p>
              <p className="u-label mt-0.5 !text-[9px] truncate">
                {e.contributorAvatar ?? "•"} {e.contributorName}
                {isMovie && e.releaseYear ? ` · ${e.releaseYear}` : ""}
              </p>
              {e.location && (
                <p className="mt-0.5 text-[9px] text-muted truncate" title={e.location}>
                  📍 {e.location}
                </p>
              )}
              {!isMovie && (e.cost || e.prep) && (
                <p className="mt-0.5 text-[9px] text-muted truncate" title={e.prep ?? undefined}>
                  {e.cost && <span className="text-ink">{e.cost === "free" ? "Free" : e.cost}</span>}
                  {e.cost && e.prep ? " · " : ""}
                  {e.prep ? `🎒 ${e.prep}` : ""}
                </p>
              )}
              {isMovie && e.imdbId && (
                <a
                  href={`https://www.imdb.com/title/${e.imdbId}/`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 inline-block text-[9px] text-accent hover:underline"
                >
                  IMDb ↗
                </a>
              )}
            </div>
            {/* Delete is available on any card (either partner can remove a
                watched movie); editing stays limited to your own ideas. Buttons
                are always visible so they work on touch too. */}
            <div className="absolute top-1 right-1 flex gap-1">
              {mine && (
                <button
                  onClick={() => onEdit(e)}
                  className="h-6 w-6 grid place-items-center rounded bg-black/50 text-xs hover:bg-black/80 transition"
                  aria-label={`Edit ${e.title}`}
                >
                  ✏️
                </button>
              )}
              <button
                onClick={() => onDelete(e)}
                className="h-6 w-6 grid place-items-center rounded bg-black/50 text-xs hover:bg-black/80 transition"
                aria-label={`Delete ${e.title}`}
              >
                🗑️
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
