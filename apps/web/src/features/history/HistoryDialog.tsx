import { Dialog } from "../../components/ui/Dialog";
import { useHistory, posterUrl } from "../roulette/hooks";
import type { Collection } from "../../shared/types";

export function HistoryDialog({
  open,
  onClose,
  collection,
}: {
  open: boolean;
  onClose: () => void;
  collection: Collection;
}) {
  const { data, isLoading } = useHistory(collection.id, open);
  const history = data?.history ?? [];
  const isMovie = collection.kind === "movies";

  return (
    <Dialog open={open} onClose={onClose} title={`${collection.name} history`} width="max-w-xl">
      {isLoading && <p className="text-muted">Loading…</p>}
      {!isLoading && history.length === 0 && (
        <p className="text-muted text-sm">No results yet — spin to make your first pick.</p>
      )}
      <div className="space-y-2">
        {history.map((h) => (
          <div key={h.periodId} className="flex items-center gap-3 rounded-lg bg-panel-2 border border-line p-3">
            <div className="w-14 text-center">
              <div className="u-display text-accent text-lg leading-none">W{h.weekIndex}</div>
              <div className="text-faint text-[10px]">cycle {h.cycleIndex}</div>
            </div>
            {isMovie && h.current.posterPath ? (
              <img src={posterUrl(h.current.posterPath, "w92")!} alt="" className="h-14 w-10 rounded object-cover" />
            ) : (
              <div className="h-12 w-12 grid place-items-center rounded-lg bg-panel-3 text-2xl">{h.current.emoji ?? "🎲"}</div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-ink font-medium truncate">{h.current.title}</p>
              <p className="u-label !text-[10px]">
                {h.current.contributor}
                {h.rerolls > 0 ? ` · rerolled ${h.rerolls}×` : ""}
              </p>
            </div>
            {h.completed ? (
              <span className="text-card-blue text-xs">✓ done</span>
            ) : (
              <span className="text-faint text-xs">pending</span>
            )}
          </div>
        ))}
      </div>
    </Dialog>
  );
}
