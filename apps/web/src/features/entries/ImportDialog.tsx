import { useRef, useState } from "react";
import type { WorkSheet } from "xlsx";
import { Dialog } from "../../components/ui/Dialog";
import { api, ApiError } from "../../platform/api/client";
import { useBulkImport, type BulkImportItem } from "../roulette/hooks";
import type { Collection, MovieResult } from "../../shared/types";
import { ImportMovieRow, type ReviewRow } from "./ImportMovieRow";

// Header names we recognise, case/space-insensitive. First match wins.
const TITLE_KEYS = ["title", "name", "movie", "idea", "activity", "date"];
const DESC_KEYS = ["description", "notes", "note", "why", "details", "detail"];
const EMOJI_KEYS = ["emoji", "icon"];
const YEAR_KEYS = ["year", "releaseyear", "release"];
const LOCATION_KEYS = ["location", "place", "where", "venue", "address"];

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

function pick(row: Record<string, unknown>, keys: string[]): string {
  const entries = Object.entries(row);
  for (const k of keys) {
    const hit = entries.find(([col]) => norm(col) === k);
    if (hit && hit[1] != null && String(hit[1]).trim()) return String(hit[1]).trim();
  }
  return "";
}

interface ColumnDetection {
  hasHeader: boolean;
  titleCol: number | null;
  yearCol: number | null;
  notesCol: number | null;
}

/** A bare number/index value ("1", "12", "3.5") — never a real title. */
const isNumericLike = (s: string) => /^\d+([.,]\d+)?$/.test(s.trim());

/**
 * Pick the column most likely to hold titles: the one with the most non-empty,
 * non-numeric, multi-character text cells. Skips index/number columns outright.
 */
function bestTextColumn(grid: string[][], skipFirstRow: boolean): number {
  const start = skipFirstRow ? 1 : 0;
  const numCols = grid.reduce((m, r) => Math.max(m, r.length), 0);
  let bestCol = 0;
  let bestScore = -1;
  for (let c = 0; c < numCols; c++) {
    let score = 0;
    for (let r = start; r < grid.length; r++) {
      const v = (grid[r]?.[c] ?? "").trim();
      if (v && !isNumericLike(v) && v.length >= 2) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCol = c;
    }
  }
  return bestCol;
}

/**
 * Parse a sheet into import rows. If a recognised Title/Movie header exists we use
 * it directly. Otherwise we read the raw grid and figure out which column holds the
 * titles — Claude reads the layout for movies (so an index column like "1,2,3…" is
 * never treated as a title), with a text-column heuristic as the fallback. Numeric
 * cells are never accepted as titles.
 */
async function parseSheet(
  utils: typeof import("xlsx").utils,
  sheet: WorkSheet,
  isMovie: boolean,
): Promise<BulkImportItem[]> {
  const objs = utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const hasTitleHeader =
    objs.length > 0 && Object.keys(objs[0]!).some((c) => TITLE_KEYS.includes(norm(c)));

  if (hasTitleHeader) {
    return objs
      .map((row) => {
        const yearRaw = pick(row, YEAR_KEYS);
        const year = yearRaw ? parseInt(yearRaw, 10) : NaN;
        return {
          title: pick(row, TITLE_KEYS),
          description: pick(row, DESC_KEYS) || null,
          emoji: isMovie ? null : pick(row, EMOJI_KEYS) || null,
          location: pick(row, LOCATION_KEYS) || null,
          releaseYear: isMovie && Number.isFinite(year) ? year : null,
        } satisfies BulkImportItem;
      })
      .filter((r) => r.title.length > 0 && !isNumericLike(r.title));
  }

  // No recognised title header — read the raw grid and detect the title column.
  const grid = (utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" }) as unknown[][]).map((r) =>
    r.map((c) => String(c ?? "").trim()),
  );
  if (grid.length === 0) return [];

  let det: ColumnDetection | null = null;
  if (isMovie) {
    try {
      const res = await api.post<{ detection: ColumnDetection | null }>("/api/movies/detect-columns", {
        grid: grid.slice(0, 8).map((r) => r.slice(0, 20)),
      });
      det = res.detection ?? null;
    } catch {
      det = null;
    }
  }

  // Treat row 0 as a header when Claude says so, or when it has no bare numbers
  // in it (a labels row) while there's data beneath.
  const headerHeuristic = grid.length > 1 && grid[0]!.length > 0 && grid[0]!.every((v) => v !== "" && !isNumericLike(v));
  const hasHeader = det?.hasHeader ?? headerHeuristic;
  const titleCol = det?.titleCol ?? bestTextColumn(grid, hasHeader);
  const yearCol = det?.yearCol ?? null;
  const notesCol = det?.notesCol ?? null;

  return grid
    .slice(hasHeader ? 1 : 0)
    .map((r) => {
      const yearRaw = yearCol != null ? r[yearCol] ?? "" : "";
      const year = yearRaw ? parseInt(yearRaw, 10) : NaN;
      return {
        title: (r[titleCol] ?? "").trim(),
        description: notesCol != null ? r[notesCol] || null : null,
        emoji: null,
        releaseYear: isMovie && Number.isFinite(year) ? year : null,
      } satisfies BulkImportItem;
    })
    .filter((r) => r.title.length > 0 && !isNumericLike(r.title));
}

export function ImportDialog({
  open,
  onClose,
  collection,
}: {
  open: boolean;
  onClose: () => void;
  collection: Collection;
}) {
  const isMovie = collection.kind === "movies";
  const importer = useBulkImport(collection.id);
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<BulkImportItem[]>([]);
  const [review, setReview] = useState<ReviewRow[] | null>(null); // movie imports only
  const [matching, setMatching] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  function reset() {
    setRows([]);
    setReview(null);
    setMatching(false);
    setFileName(null);
    setError(null);
    setDone(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  /** Ask the server for a best-guess TMDB match per title, then open the review step. */
  async function buildReview(parsed: BulkImportItem[]) {
    setMatching(true);
    setError(null);
    const titles = parsed.map((r) => ({ title: r.title, year: r.releaseYear ?? null }));
    try {
      const res = await api.post<{ enabled?: boolean; matches?: { query: string; year: number | null; match: MovieResult | null }[] }>(
        "/api/movies/match",
        { titles: titles.slice(0, 200) },
      );
      const matches = res.matches ?? [];
      setReview(
        parsed.map((r, i) => {
          const choice = matches[i]?.match ?? null;
          // Confident matches start ticked; rows with no match start unticked so
          // "Add selected" only brings in the good ones until you decide on the rest.
          return { query: r.title, description: r.description ?? null, year: r.releaseYear ?? null, choice, included: choice !== null };
        }),
      );
    } catch {
      // Matching unavailable (e.g. no TMDB key) — fall back to plain-text rows, ticked.
      setReview(
        parsed.map((r) => ({ query: r.title, description: r.description ?? null, year: r.releaseYear ?? null, choice: null, included: true })),
      );
    } finally {
      setMatching(false);
    }
  }

  async function onFile(file: File) {
    setError(null);
    setDone(null);
    try {
      const XLSX = await import("xlsx"); // lazy — keeps the library out of the main bundle
      // CSV/TSV are text: decode as UTF-8 (file.text()) so emoji and accented
      // characters survive. Native .xlsx/.xls are binary — read as a byte array.
      const isText = /\.(csv|tsv|txt)$/i.test(file.name) || file.type.startsWith("text/");
      const wb = isText
        ? XLSX.read(await file.text(), { type: "string" })
        : XLSX.read(await file.arrayBuffer(), { type: "array" });
      const first = wb.SheetNames[0];
      if (!first) throw new Error("empty");
      const parsed = await parseSheet(XLSX.utils, wb.Sheets[first]!, isMovie);
      if (parsed.length === 0) {
        setError("No rows with a title found. Make sure the first column (or a 'Title' column) has the idea names.");
        setRows([]);
        setReview(null);
      } else {
        setRows(parsed);
        setFileName(file.name);
        // Movies get a match-and-review step; date ideas import straight from the preview.
        if (isMovie) await buildReview(parsed);
        else setReview(null);
        return;
      }
      setFileName(file.name);
    } catch {
      setError("Couldn't read that file. Supported: .xlsx, .xls, .csv.");
      setRows([]);
    }
  }

  // Turn the reviewed movie rows into import items: matched rows carry the
  // TMDB title + poster; "as text" rows keep the original spreadsheet title.
  function reviewToItems(list: ReviewRow[]): BulkImportItem[] {
    return list
      .filter((r) => r.included) // only ticked rows are added
      .map((r) =>
        r.choice
          ? {
              title: r.choice.title,
              description: r.description,
              releaseYear: r.choice.releaseYear,
              tmdbId: r.choice.tmdbId,
              posterPath: r.choice.posterPath,
              backdropPath: r.choice.backdropPath,
            }
          : { title: r.query, description: r.description, releaseYear: r.year },
      );
  }

  async function runImport() {
    setError(null);
    const items = review ? reviewToItems(review) : rows;
    try {
      const res = await importer.mutateAsync(items.slice(0, 500));
      setDone(res.count);
      setRows([]);
      setReview(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Import failed.");
    }
  }

  function close() {
    reset();
    onClose();
  }

  return (
    <Dialog open={open} onClose={close} title={`Import ${isMovie ? "movies" : "ideas"} to ${collection.name}`}>
      <div className="space-y-4">
        {done !== null ? (
          <div className="space-y-4">
            <p className="text-ink text-sm">
              Imported <span className="u-display text-accent">{done}</span> {isMovie ? "movies" : "ideas"} — added as
              yours. They're in the pool now.
            </p>
            <div className="flex justify-end gap-2">
              <button className="rounded-md px-4 py-2 text-sm text-muted hover:text-ink" onClick={reset}>
                Import another file
              </button>
              <button className="btn-yellow !py-2 !text-base" onClick={close}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div>
              <p className="text-muted text-sm mb-2">
                Upload a spreadsheet. First sheet is used. Columns are auto-detected — a{" "}
                <span className="text-ink">Title</span> column (or the first column) is required;{" "}
                <span className="text-ink">Notes</span>
                {isMovie ? (
                  <>
                    {" "}and <span className="text-ink">Year</span>
                  </>
                ) : (
                  <>
                    {" "}and <span className="text-ink">Emoji</span>
                  </>
                )}{" "}
                are optional.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border file:border-line file:bg-panel-3 file:px-4 file:py-2 file:text-ink hover:file:border-accent file:transition"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                }}
              />
            </div>

            {/* Date ideas: plain preview table straight from the sheet. */}
            {rows.length > 0 && !isMovie && (
              <div>
                <p className="u-label mb-1">
                  {fileName} · {rows.length} row{rows.length === 1 ? "" : "s"} ready
                </p>
                <div className="max-h-56 overflow-y-auto rounded-md border border-line bg-panel-2">
                  <table className="w-full text-sm">
                    <thead className="text-faint">
                      <tr className="border-b border-line">
                        <th className="text-left px-3 py-1.5 font-normal u-label">Title</th>
                        <th className="text-left px-3 py-1.5 font-normal u-label">Emoji</th>
                        <th className="text-left px-3 py-1.5 font-normal u-label">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 50).map((r, i) => (
                        <tr key={i} className="border-b border-line/50 last:border-0">
                          <td className="px-3 py-1.5 text-ink">{r.title}</td>
                          <td className="px-3 py-1.5 text-muted">{r.emoji ?? ""}</td>
                          <td className="px-3 py-1.5 text-muted truncate max-w-[16rem]">{r.description ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rows.length > 50 && <p className="text-faint text-xs mt-1">Showing first 50 of {rows.length}.</p>}
              </div>
            )}

            {/* Movies: match each row to a real film and let the user correct wrong guesses. */}
            {isMovie && matching && (
              <p className="text-center text-muted text-sm py-6">Finding the best match for {rows.length} movies…</p>
            )}

            {isMovie && review && !matching && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="u-label">
                    {fileName} · review {review.length} — nothing added yet
                  </p>
                  <div className="flex gap-2 text-xs">
                    <button
                      type="button"
                      className="text-muted hover:text-ink"
                      onClick={() => setReview((prev) => prev && prev.map((x) => ({ ...x, included: true })))}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="text-muted hover:text-ink"
                      onClick={() => setReview((prev) => prev && prev.map((x) => ({ ...x, included: false })))}
                    >
                      None
                    </button>
                  </div>
                </div>
                <div className="max-h-72 overflow-y-auto space-y-1.5 pr-0.5">
                  {review.map((r, i) => (
                    <ImportMovieRow
                      key={i}
                      row={r}
                      onChange={(choice) =>
                        setReview((prev) =>
                          prev && prev.map((x, j) => (j === i ? { ...x, choice, included: true } : x)),
                        )
                      }
                      onToggle={(included) =>
                        setReview((prev) => prev && prev.map((x, j) => (j === i ? { ...x, included } : x)))
                      }
                    />
                  ))}
                </div>
                <p className="text-faint text-xs mt-1">
                  Tick the ones you want, correct any wrong matches, then add them. Unticked rows are skipped.
                </p>
              </div>
            )}

            {error && <p className="text-card-red text-sm">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button className="rounded-md px-4 py-2 text-sm text-muted hover:text-ink" onClick={close}>
                Cancel
              </button>
              {(() => {
                const count = review ? review.filter((r) => r.included).length : rows.length;
                return (
                  <button
                    className="btn-yellow !py-2 !text-base"
                    onClick={runImport}
                    disabled={count === 0 || matching || importer.isPending}
                  >
                    {importer.isPending
                      ? "Importing…"
                      : review
                        ? `Add ${count} selected`
                        : `Import ${count || ""}`.trim()}
                  </button>
                );
              })()}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
