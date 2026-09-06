import { useEffect, useState } from "react";
import { Dialog } from "../../components/ui/Dialog";
import { api, ApiError } from "../../platform/api/client";
import { posterUrl } from "../roulette/hooks";
import { MoviePicker } from "./MoviePicker";
import { PlaceFinder } from "./PlaceFinder";
import type { Collection, Entry, MovieResult, PlaceResult } from "../../shared/types";
import { useQueryClient } from "@tanstack/react-query";

type Cost = "free" | "$" | "$$" | "$$$";
const COSTS: { key: Cost; label: string }[] = [
  { key: "free", label: "Free" },
  { key: "$", label: "$" },
  { key: "$$", label: "$$" },
  { key: "$$$", label: "$$$" },
];

export function EntryDialog({
  open,
  onClose,
  collection,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  collection: Collection;
  editing: Entry | null;
}) {
  const qc = useQueryClient();
  const isMovie = collection.kind === "movies";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [cost, setCost] = useState<Cost | null>(null);
  const [prep, setPrep] = useState("");
  const [releaseYear, setReleaseYear] = useState<number | null>(null);
  const [posterPath, setPosterPath] = useState<string | null>(null);
  const [backdropPath, setBackdropPath] = useState<string | null>(null);
  const [tmdbId, setTmdbId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editing) {
      setTitle(editing.title);
      setDescription(editing.description ?? "");
      setLocation(editing.location ?? "");
      setCost(editing.cost);
      setPrep(editing.prep ?? "");
      setReleaseYear(editing.releaseYear);
      setPosterPath(editing.posterPath);
      setBackdropPath(editing.backdropPath);
      setTmdbId(editing.tmdbId);
    } else {
      setTitle("");
      setDescription("");
      setLocation("");
      setCost(null);
      setPrep("");
      setReleaseYear(null);
      setPosterPath(null);
      setBackdropPath(null);
      setTmdbId(null);
    }
  }, [open, editing, isMovie]);

  function pickMovie(m: MovieResult) {
    setTitle(m.title);
    setReleaseYear(m.releaseYear);
    setPosterPath(m.posterPath);
    setBackdropPath(m.backdropPath);
    setTmdbId(m.tmdbId);
  }

  function pickPlace(p: PlaceResult) {
    setTitle(p.name);
    setLocation(p.address ?? p.name);
  }

  async function save() {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = {
      title,
      description: description || null,
      location: location || null,
      cost: isMovie ? null : cost,
      prep: isMovie ? null : prep || null,
      releaseYear,
      posterPath,
      backdropPath,
      tmdbId,
    };
    // Movies use poster art (no emoji). Date ideas get an emoji picked
    // automatically on the server, so we never send one from here.
    if (isMovie) payload.emoji = null;
    try {
      if (editing) await api.patch(`/api/entries/${editing.id}`, payload);
      else await api.post(`/api/collections/${collection.id}/entries`, payload);
      qc.invalidateQueries({ queryKey: ["entries", collection.id] });
      qc.invalidateQueries({ queryKey: ["collections"] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={editing ? "Edit idea" : `Add to ${collection.name}`}>
      <div className="space-y-4">
        {isMovie && !editing && (
          <div>
            <label className="u-label block mb-1">Browse & search movies</label>
            <MoviePicker onPick={pickMovie} />
            <p className="text-faint text-xs mt-1">Pick one to add it with its poster, or fill it in manually below.</p>
          </div>
        )}

        {!isMovie && !editing && (
          <div>
            <label className="u-label block mb-1">Find a place (optional)</label>
            <PlaceFinder onPick={pickPlace} />
            <p className="text-faint text-xs mt-1">Pick a spot to fill the title & location, or just type your own idea below.</p>
          </div>
        )}

        <div>
          <label className="u-label block mb-1">{isMovie ? "Selected movie" : "Title"}</label>
          <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isMovie ? "Movie title" : "Idea title"} />
        </div>

        {isMovie ? (
          <div className="flex items-center gap-3">
            {posterPath ? (
              <img src={posterUrl(posterPath, "w154")!} alt="" className="h-24 w-16 object-cover rounded-md border border-line" />
            ) : (
              <div className="h-24 w-16 grid place-items-center rounded-md bg-panel-3 border border-line text-2xl">🎬</div>
            )}
            <div className="flex-1">
              <label className="u-label block mb-1">Release year</label>
              <input
                className="field"
                type="number"
                value={releaseYear ?? ""}
                onChange={(e) => setReleaseYear(e.target.value ? Number(e.target.value) : null)}
                placeholder="e.g. 2023"
              />
              {tmdbId ? <p className="text-faint text-xs mt-1">Linked to TMDB #{tmdbId}</p> : <p className="text-faint text-xs mt-1">Manual entry (no artwork)</p>}
            </div>
          </div>
        ) : (
          <div className="rounded-md bg-panel-2 border border-line p-3 flex items-center gap-3">
            <span className="text-2xl" aria-hidden>
              {editing?.emoji ?? "✨"}
            </span>
            <p className="text-muted text-sm">We'll pick a fitting emoji for this idea automatically when you save.</p>
          </div>
        )}

        <div>
          <label className="u-label block mb-1">Location (optional)</label>
          <input
            className="field"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={isMovie ? "e.g. the cinema, at home…" : "e.g. Central Park, home, that little bistro…"}
          />
        </div>

        {!isMovie && (
          <>
            <div>
              <label className="u-label block mb-1">Cost (optional)</label>
              <div className="flex gap-1.5">
                {COSTS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setCost(cost === c.key ? null : c.key)}
                    className={`text-sm px-3 py-1.5 rounded-md transition ${
                      cost === c.key ? "bg-accent text-header" : "bg-panel-3 text-muted hover:text-ink"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="u-label block mb-1">What to prepare (optional)</label>
              <input
                className="field"
                value={prep}
                onChange={(e) => setPrep(e.target.value)}
                placeholder="e.g. book a table, pack swimsuits, charge the camera…"
              />
            </div>
          </>
        )}

        <div>
          <label className="u-label block mb-1">Notes (optional)</label>
          <textarea
            className="field min-h-[72px]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={isMovie ? "Why this pick?" : "Anything else about this idea…"}
          />
        </div>

        {error && <p className="text-card-red text-sm">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button className="rounded-md px-4 py-2 text-sm text-muted hover:text-ink" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-yellow !py-2 !text-base" onClick={save} disabled={busy}>
            {busy ? "…" : editing ? "Save" : "Add idea"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
