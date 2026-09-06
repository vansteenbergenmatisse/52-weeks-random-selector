import { anthropicEnabled } from "../../platform/config/env.js";
import { callClaude } from "../../platform/ai/claude.js";
import type { MovieResult } from "./tmdb.js";

export interface AiMatchRow {
  query: string;
  year: number | null;
  candidates: MovieResult[];
}

const MAX_OPTIONS = 6;

export interface ColumnDetection {
  hasHeader: boolean;
  titleCol: number | null;
  yearCol: number | null;
  notesCol: number | null;
}

/** Coerce a raw model verdict into a valid, in-range ColumnDetection (or null). */
export function sanitizeDetection(raw: unknown, numCols: number): ColumnDetection | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const col = (v: unknown): number | null =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 && v < numCols ? v : null;
  const titleCol = col(r.titleCol);
  if (titleCol === null) return null; // no usable title column → let the caller fall back
  return {
    hasHeader: r.hasHeader === true,
    titleCol,
    yearCol: col(r.yearCol),
    notesCol: col(r.notesCol),
  };
}

/** Extract the first JSON object from arbitrary model text. */
function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Ask Claude to read the first rows of a spreadsheet and say which column holds
 * the movie titles (and, if present, year/notes) — so an index/number column
 * like "1, 2, 3…" is never mistaken for a title. Returns null when AI is
 * unavailable or can't decide, so the caller uses its text heuristic.
 */
export async function detectColumns(grid: string[][]): Promise<ColumnDetection | null> {
  if (!anthropicEnabled) return null;
  const numCols = grid.reduce((m, r) => Math.max(m, r.length), 0);
  if (numCols === 0 || grid.length === 0) return null;

  const prompt =
    `Below are the first rows of a spreadsheet of MOVIES, as a JSON 2D array (each inner array is a row of cell values).\n` +
    `Identify the columns by their 0-based index:\n` +
    `- "titleCol": the column holding the MOVIE TITLES. NEVER pick a column that is just row numbers / an index (1,2,3…), a year, a rating, or notes.\n` +
    `- "yearCol": the column of release years, or null.\n` +
    `- "notesCol": the column of notes/description, or null.\n` +
    `- "hasHeader": true if the FIRST row is a header/labels row rather than movie data.\n` +
    `Return ONLY JSON: {"hasHeader":boolean,"titleCol":number,"yearCol":number|null,"notesCol":number|null}. No prose.\n\n` +
    `Rows:\n${JSON.stringify(grid)}`;

  const text = await callClaude(prompt, 200);
  if (!text) return null;
  return sanitizeDetection(parseJsonObject(text), numCols);
}

/** Extract the first JSON array from arbitrary model text. */
function parseJsonArray(text: string): unknown[] | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Reconcile Claude's `{i, id}` verdicts against the candidate lists. Only ids
 * that actually appear in that row's candidates are accepted (guards against a
 * hallucinated id); everything else becomes null (no confident match).
 * Rows with no candidates are skipped up front (always null).
 */
export function reconcileAiPicks(rows: AiMatchRow[], verdicts: unknown[]): (number | null)[] {
  const byIndex = new Map<number, number | null>();
  for (const raw of verdicts) {
    const v = raw as { i?: unknown; id?: unknown };
    if (typeof v?.i === "number") byIndex.set(v.i, typeof v.id === "number" ? v.id : null);
  }
  return rows.map((row, i) => {
    if (row.candidates.length === 0) return null;
    const id = byIndex.get(i);
    if (typeof id !== "number") return null;
    return row.candidates.some((c) => c.tmdbId === id) ? id : null;
  });
}

/**
 * Use Claude to choose the correct film per row from its TMDB candidates.
 * Returns a chosen tmdbId (or null) aligned by index, or null overall when AI is
 * unavailable or the call fails — signalling the caller to use its heuristic.
 */
export async function aiPickMatches(rows: AiMatchRow[]): Promise<(number | null)[] | null> {
  if (!anthropicEnabled || rows.length === 0) return null;
  // Only ask about rows that actually have candidates to choose from.
  const askable = rows.filter((r) => r.candidates.length > 0);
  if (askable.length === 0) return rows.map(() => null);

  const payload = rows.map((r, i) => ({
    i,
    title: r.query.slice(0, 150),
    year: r.year,
    options: r.candidates.slice(0, MAX_OPTIONS).map((c) => ({ id: c.tmdbId, title: c.title, year: c.releaseYear })),
  }));

  const prompt =
    `You match messy spreadsheet movie titles to the correct film.\n` +
    `For each item, pick the "id" of the option that is the SAME movie as "title". ` +
    `Titles may have typos, be translated, use a different language, or drop articles; ` +
    `use "year" to disambiguate remakes when it is given. ` +
    `If none of the options is clearly the same movie, use null — do not guess.\n` +
    `Return ONLY a JSON array of {"i": number, "id": number|null}, one per item, in order. No prose.\n\n` +
    `Items:\n${JSON.stringify(payload)}`;

  const text = await callClaude(prompt, Math.min(2000, rows.length * 16 + 60));
  if (!text) return null;
  const arr = parseJsonArray(text);
  if (!arr) return null;
  return reconcileAiPicks(rows, arr);
}
