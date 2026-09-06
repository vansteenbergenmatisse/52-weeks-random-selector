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
  // Watched/done ideas stay listed so either partner can still remove them —
  // otherwise a completed pick lingers invisibly and can resurface as a ghost.
  const watched = entries.filter((e) => e.status === "completed");

  if (available.length === 0 && watched.length === 0) {
    return (
      <div className="text-center py-10 text-muted">
        <p className="text-2xl mb-1">🫙</p>
        <p className="text-sm">No ideas in the pool yet. Add a few to start spinning.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {available.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7 gap-2.5">
          {available.map((e) => (
            <IdeaCard
              key={e.id}
              entry={e}
              collection={collection}
              isMovie={isMovie}
              mine={e.contributorId === currentUserId}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}

      {watched.length > 0 && (
        <div>
          <p className="u-label mb-2">✓ Watched · not in the pool</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7 gap-2.5">
            {watched.map((e) => (
              <IdeaCard
                key={e.id}
                entry={e}
                collection={collection}
                isMovie={isMovie}
                mine={e.contributorId === currentUserId}
                onEdit={onEdit}
                onDelete={onDelete}
                watched
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function IdeaCard({
  entry: e,
  collection,
  isMovie,
  mine,
  onEdit,
  onDelete,
  watched = false,
}: {
  entry: Entry;
  collection: Collection;
  isMovie: boolean;
  mine: boolean;
  onEdit: (e: Entry) => void;
  onDelete: (e: Entry) => void;
  watched?: boolean;
}) {
  return (
    <div
      className={`group relative rounded-lg bg-panel-2 border border-line overflow-hidden hover:border-muted transition ${CORNER[collection.colorKey]} border-b-2 ${watched ? "opacity-60" : ""}`}
    >
      <div className="aspect-[3/4] grid place-items-center bg-panel-3 overflow-hidden">
        {isMovie && e.posterPath ? (
          <img src={posterUrl(e.posterPath, "w185")!} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span className="text-4xl">{e.emoji ?? (isMovie ? "🎬" : "🎲")}</span>
        )}
      </div>
      {watched && (
        <span className="absolute top-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-white">✓ Watched</span>
      )}
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
      {/* Delete is available on any card (either partner can remove a watched
          movie); editing stays limited to your own, available ideas. Buttons
          are always visible so they work on touch too. */}
      <div className="absolute top-1 right-1 flex gap-1">
        {mine && !watched && (
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
}
