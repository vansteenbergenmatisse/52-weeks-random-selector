import type { Progress } from "../../shared/types";

/** Per-person count of what each partner currently has in the pool. */
export function ProgressRow({ progress, noun = "ideas" }: { progress: Progress; noun?: string }) {
  return (
    <div className="flex flex-wrap gap-3">
      {progress.contributors.map((c) => {
        const pct = Math.min(100, Math.round((c.added / c.target) * 100));
        return (
          <div key={c.userId} className="flex-1 min-w-[200px] rounded-lg bg-panel-2 border border-line px-3.5 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-xl" aria-hidden>
                {c.avatarUrl ?? "🙂"}
              </span>
              <span className="text-ink font-medium text-sm">{c.displayName}</span>
              <span className="ml-auto flex items-baseline gap-1">
                <span className="u-display text-2xl leading-none text-accent">{c.added}</span>
                <span className="text-muted text-xs">/ {c.target} {noun}</span>
              </span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-panel-3 overflow-hidden">
              <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
