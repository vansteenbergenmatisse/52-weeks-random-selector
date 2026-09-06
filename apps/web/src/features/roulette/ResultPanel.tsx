import { posterUrl } from "./hooks";
import type { Collection, CurrentState } from "../../shared/types";

const TILE: Record<Collection["colorKey"], string> = {
  red: "from-card-red to-card-red-2",
  blue: "from-card-blue to-card-blue-2",
  purple: "from-card-purple to-card-purple-2",
  charcoal: "from-card-charcoal to-card-charcoal-2",
};

export function ResultPanel({
  state,
  collection,
  onReroll,
  onComplete,
  onAddToCalendar,
  rerolling,
  addingToCalendar,
  rerollNote,
  calendarNote,
}: {
  state: CurrentState;
  collection: Collection;
  onReroll: () => void;
  onComplete: () => void;
  onAddToCalendar: () => void;
  rerolling: boolean;
  addingToCalendar: boolean;
  rerollNote: string | null;
  calendarNote: string | null;
}) {
  const r = state.result;
  if (!r) return null;
  const isMovie = collection.kind === "movies";
  const backdrop = posterUrl(r.backdropPath, "w780");

  return (
    <div className="relative rounded-xl overflow-hidden bg-panel-2 border border-line">
      {isMovie && backdrop && (
        <div className="absolute inset-0 opacity-25" style={{ backgroundImage: `url(${backdrop})`, backgroundSize: "cover", backgroundPosition: "center" }} />
      )}
      <div className="relative p-4 sm:p-5 flex items-center gap-4">
        <div className="shrink-0">
          {isMovie && r.posterPath ? (
            <img src={posterUrl(r.posterPath, "w185")!} alt="" className="h-24 w-16 rounded-md object-cover border border-line" />
          ) : (
            <div className={`h-20 w-20 grid place-items-center rounded-xl bg-gradient-to-b ${TILE[collection.colorKey]} text-4xl`}>
              {r.emoji ?? (isMovie ? "🎬" : "🎲")}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="u-label">
            This week's {collection.name.toLowerCase().replace(/s$/, "")} · Week {state.weekIndex}
            {state.revision > 1 ? ` · rerolled ${state.revision - 1}×` : ""}
          </p>
          <h3 className="text-xl font-bold text-ink truncate">{r.title}</h3>
          <p className="text-sm text-muted">
            Added by {r.contributor}
            {isMovie && r.imdbId && (
              <>
                {" · "}
                <a
                  href={`https://www.imdb.com/title/${r.imdbId}/`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  IMDb ↗
                </a>
              </>
            )}
          </p>
          {r.location && <p className="text-sm text-muted mt-0.5">📍 {r.location}</p>}
          {r.description && <p className="text-sm text-muted/80 mt-1 line-clamp-2">{r.description}</p>}
        </div>
        <div className="shrink-0 flex flex-col gap-2">
          {state.completed ? (
            <span className="u-display text-sm text-accent bg-accent/15 rounded-md px-3 py-2">✓ Completed</span>
          ) : (
            <>
              <button
                onClick={onComplete}
                className="rounded-md bg-panel-3 border border-line px-3 py-2 text-sm text-ink hover:border-accent transition"
              >
                ✅ Mark done
              </button>
              <button
                onClick={onReroll}
                disabled={rerolling}
                className="rounded-md bg-panel-3 border border-line px-3 py-2 text-sm text-ink hover:border-accent transition disabled:opacity-50"
              >
                🔄 {rerolling ? "…" : "Reroll"}
              </button>
            </>
          )}
          <button
            onClick={onAddToCalendar}
            disabled={addingToCalendar}
            className="rounded-md bg-panel-3 border border-line px-3 py-2 text-sm text-ink hover:border-accent transition disabled:opacity-50"
          >
            📅 {addingToCalendar ? "…" : "Add to calendar"}
          </button>
        </div>
      </div>
      {rerollNote && <p className="relative px-5 pb-3 -mt-1 text-xs text-accent">{rerollNote}</p>}
      {calendarNote && <p className="relative px-5 pb-3 -mt-1 text-xs text-accent">{calendarNote}</p>}
    </div>
  );
}
