import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/useAuth";
import { useLiveSync } from "../../platform/realtime/useLiveSync";
import { Wordmark } from "../../components/ui/Wordmark";
import { api } from "../../platform/api/client";
import { useCollections, useEntries } from "../roulette/hooks";
import { IdeaGrid } from "./IdeaGrid";
import { ProgressRow } from "./ProgressRow";
import { EntryDialog } from "./EntryDialog";
import { ImportDialog } from "./ImportDialog";
import type { Entry } from "../../shared/types";

export function PoolPage() {
  const { user, couple } = useAuth();
  useLiveSync(true);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();

  const { data: colData } = useCollections();
  const collections = colData?.collections ?? [];
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (collections.length === 0) return;
    const fromUrl = params.get("collection");
    if (fromUrl && collections.some((c) => c.id === fromUrl)) setActiveId(fromUrl);
    else if (!activeId) setActiveId(collections[0]!.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collections]);

  const active = collections.find((c) => c.id === activeId) ?? null;

  const { data: entriesData } = useEntries(active?.id);
  const entries = entriesData?.entries ?? [];
  const progress = entriesData?.progress;

  const [entryDialog, setEntryDialog] = useState<{ open: boolean; editing: Entry | null }>({ open: false, editing: null });
  const [showImport, setShowImport] = useState(false);
  const [undo, setUndo] = useState<{ id: string; title: string } | null>(null);

  const isMovie = active?.kind === "movies";

  function refresh() {
    qc.invalidateQueries({ queryKey: ["entries", active?.id] });
    qc.invalidateQueries({ queryKey: ["collections"] });
  }

  // One-tap delete (no confirm). Soft-delete on the server means we can offer a
  // brief Undo instead of a blocking "are you sure?" prompt.
  async function onDelete(e: Entry) {
    setUndo({ id: e.id, title: e.title });
    await api.del(`/api/entries/${e.id}`);
    refresh();
  }

  async function undoDelete() {
    if (!undo) return;
    await api.post(`/api/entries/${undo.id}/restore`);
    setUndo(null);
    refresh();
  }

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(t);
  }, [undo]);

  function select(id: string) {
    setActiveId(id);
    setParams({ collection: id });
  }

  return (
    <div className="app-backdrop min-h-screen py-3 px-2 sm:py-6 sm:px-4">
      <div className="mx-auto max-w-4xl rounded-2xl bg-panel border border-line shadow-panel overflow-hidden">
        {/* Header */}
        <header className="relative bg-header border-b border-line h-12 flex items-center justify-center">
          <Wordmark />
          <div className="absolute left-3">
            <button
              onClick={() => navigate(active ? `/app?collection=${active.id}` : "/app")}
              className="flex items-center gap-1.5 rounded-md bg-panel-3 border border-line px-2.5 py-1 text-sm text-muted hover:text-ink hover:border-muted transition"
            >
              ← Roulette
            </button>
          </div>
          <div className="absolute right-3">
            <span className="hidden sm:inline text-xs text-muted">{couple?.name}</span>
          </div>
        </header>

        {/* Tabs */}
        <div className="flex items-center justify-between gap-2 px-3 sm:px-5 py-2.5 border-b border-line bg-panel-2/50 flex-wrap">
          <div className="flex gap-1.5 overflow-x-auto">
            {collections.map((c) => (
              <button
                key={c.id}
                onClick={() => select(c.id)}
                className={`u-display text-sm px-3 py-1.5 rounded-md whitespace-nowrap transition ${
                  c.id === activeId ? "bg-accent text-header" : "text-muted hover:text-ink bg-panel-3/60"
                }`}
              >
                <span className="mr-1">{c.emoji}</span>
                {c.name}
              </button>
            ))}
          </div>
        </div>

        {active ? (
          <div className="px-3 sm:px-6 py-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h1 className="u-display text-lg text-ink">
                {active.name} — ideas in the pool
              </h1>
              <div className="flex gap-2">
                <button
                  className="rounded-md bg-panel-3 border border-line px-4 py-1.5 text-sm text-ink hover:border-accent transition"
                  onClick={() => setShowImport(true)}
                >
                  ⬆ Import from Excel
                </button>
                <button
                  className="btn-yellow !py-1.5 !px-4 !text-sm"
                  onClick={() => setEntryDialog({ open: true, editing: null })}
                >
                  + Add {isMovie ? "movie" : "idea"}
                </button>
              </div>
            </div>

            {progress && (
              <div className="mb-5">
                <ProgressRow progress={progress} noun={isMovie ? "movies" : "ideas"} />
              </div>
            )}

            <IdeaGrid
              entries={entries}
              collection={active}
              currentUserId={user!.id}
              onEdit={(e) => setEntryDialog({ open: true, editing: e })}
              onDelete={onDelete}
            />
          </div>
        ) : (
          <div className="p-10 text-center text-muted">Loading your collections…</div>
        )}
      </div>
      <p className="text-center text-white/50 text-xs mt-3">Our 52 · a date & movie for every week</p>

      {/* Undo toast — one-tap delete is instant but reversible for a few seconds. */}
      {undo && (
        <div className="fixed inset-x-0 bottom-4 flex justify-center px-4 z-50">
          <div className="flex items-center gap-3 rounded-lg bg-panel-2 border border-line shadow-panel px-4 py-2.5">
            <span className="text-sm text-ink truncate max-w-[60vw]">
              Removed <span className="font-medium">{undo.title}</span>
            </span>
            <button onClick={undoDelete} className="text-sm text-accent font-medium hover:underline">
              Undo
            </button>
          </div>
        </div>
      )}

      {/* Dialogs */}
      {active && (
        <>
          <EntryDialog
            open={entryDialog.open}
            editing={entryDialog.editing}
            collection={active}
            onClose={() => setEntryDialog({ open: false, editing: null })}
          />
          <ImportDialog open={showImport} onClose={() => setShowImport(false)} collection={active} />
        </>
      )}
    </div>
  );
}
