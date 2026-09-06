import { env, tmdbEnabled } from "../../platform/config/env.js";
import { logger } from "../../platform/logger/logger.js";
import { aiPickMatches } from "./aiMatch.js";

const TMDB_BASE = "https://api.themoviedb.org/3";

export interface MovieResult {
  tmdbId: number;
  title: string;
  releaseYear: number | null;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  rating: number | null; // TMDB vote average, 0–10 (1 decimal)
}

export interface Genre {
  id: number;
  name: string;
}

export type DiscoverMode = "trending" | "popular" | "top_rated";

export function tmdbStatus() {
  return {
    enabled: tmdbEnabled,
    imageBase: env.TMDB_IMAGE_BASE,
    // Attribution required by TMDB's terms.
    attribution: "This product uses the TMDB API but is not endorsed or certified by TMDB.",
    note: tmdbEnabled
      ? "TMDB search is active."
      : "No TMDB API key configured — add TMDB_API_KEY to enable automatic movie search and artwork. Manual movie entry still works.",
  };
}

/** Shared TMDB GET that accepts the key as a v4 bearer token, falling back to the v3 key param. */
async function tmdbFetch(path: string, params: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set("language", "en-US");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.TMDB_API_KEY}`, Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 401) {
    url.searchParams.set("api_key", env.TMDB_API_KEY);
    const res2 = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res2.ok) throw new Error(`TMDB ${res2.status}`);
    return res2.json();
  }
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json();
}

function mapResults(data: unknown, limit = 18): MovieResult[] {
  const results = (data as { results?: unknown[] })?.results ?? [];
  return results
    .slice(0, limit)
    .map((raw) => {
      const r = raw as Record<string, unknown>;
      const date = (r.release_date as string) || "";
      const year = date ? Number(date.slice(0, 4)) : null;
      const vote = Number(r.vote_average);
      return {
        tmdbId: Number(r.id),
        title: String(r.title ?? r.name ?? "Untitled"),
        releaseYear: Number.isFinite(year) ? year : null,
        overview: String(r.overview ?? ""),
        posterPath: (r.poster_path as string) ?? null,
        backdropPath: (r.backdrop_path as string) ?? null,
        rating: Number.isFinite(vote) && vote > 0 ? Math.round(vote * 10) / 10 : null,
      };
    })
    .filter((m) => Number.isFinite(m.tmdbId));
}

export async function searchMovies(query: string): Promise<MovieResult[]> {
  if (!tmdbEnabled) return [];
  const q = query.trim();
  if (!q) return [];
  try {
    return mapResults(await tmdbFetch("/search/movie", { query: q, include_adult: "false", page: "1" }), 18);
  } catch (err) {
    logger.warn({ err: String(err) }, "TMDB search failed");
    throw new Error("Movie search is temporarily unavailable");
  }
}

/**
 * Choose the best candidate for an imported row. Prefers an exact
 * (case-insensitive) title match, then a matching release year, then TMDB's own
 * popularity order (results arrive pre-sorted). Returns null for no results.
 */
export function pickBestMatch(query: string, year: number | null, results: MovieResult[]): MovieResult | null {
  if (results.length === 0) return null;
  const q = query.trim().toLowerCase();
  const score = (m: MovieResult) => {
    let s = 0;
    if (m.title.trim().toLowerCase() === q) s += 4;
    if (year && m.releaseYear === year) s += 2;
    return s;
  };
  let best = results[0]!;
  let bestScore = score(best);
  // Keep TMDB's popularity order as the tiebreak by only replacing on a strictly
  // higher score (results[0] is the most popular by default).
  for (const m of results.slice(1)) {
    const s = score(m);
    if (s > bestScore) {
      best = m;
      bestScore = s;
    }
  }
  return best;
}

export interface MatchInput {
  title: string;
  year?: number | null;
}

export interface MatchResult {
  query: string;
  year: number | null;
  match: MovieResult | null;
}

/**
 * Suggest a TMDB movie for each imported title. Searches candidates with bounded
 * concurrency, then lets Claude pick the correct film per row (handles typos,
 * translations, missing years). Falls back to the string/year heuristic when
 * Claude is unavailable or the call fails.
 */
export async function matchMovies(items: MatchInput[]): Promise<MatchResult[]> {
  if (!tmdbEnabled) return items.map((i) => ({ query: i.title, year: i.year ?? null, match: null }));

  // 1. Gather TMDB candidates per title.
  const candidates: MovieResult[][] = new Array(items.length).fill(null).map(() => []);
  const CONCURRENCY = 5;
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      try {
        candidates[idx] = await searchMovies(items[idx]!.title);
      } catch {
        candidates[idx] = [];
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));

  // 2. Prefer Claude's judgement; fall back to the heuristic per row.
  let aiPicks: (number | null)[] | null = null;
  try {
    aiPicks = await aiPickMatches(
      items.map((it, i) => ({ query: it.title, year: it.year ?? null, candidates: candidates[i]! })),
    );
  } catch {
    aiPicks = null;
  }

  return items.map((it, i) => {
    const year = it.year ?? null;
    const cands = candidates[i]!;
    let match: MovieResult | null;
    if (aiPicks) {
      const id = aiPicks[i];
      match = id != null ? cands.find((c) => c.tmdbId === id) ?? null : null;
    } else {
      match = pickBestMatch(it.title, year, cands);
    }
    return { query: it.title, year, match };
  });
}

export async function getGenres(): Promise<Genre[]> {
  if (!tmdbEnabled) return [];
  try {
    const data = (await tmdbFetch("/genre/movie/list")) as { genres?: Genre[] };
    return (data.genres ?? []).map((g) => ({ id: g.id, name: g.name }));
  } catch (err) {
    logger.warn({ err: String(err) }, "TMDB genres failed");
    return [];
  }
}

/** Fetch a movie's IMDb id (e.g. "tt0245429") from its TMDB id, or null. */
export async function getImdbId(tmdbId: number): Promise<string | null> {
  if (!tmdbEnabled || !Number.isFinite(tmdbId)) return null;
  try {
    const data = (await tmdbFetch(`/movie/${tmdbId}/external_ids`)) as { imdb_id?: string | null };
    return data.imdb_id || null;
  } catch (err) {
    logger.warn({ err: String(err) }, "TMDB external_ids failed");
    return null;
  }
}

/** Browse "good movies" without a title — by mode and optional genre. */
export async function discoverMovies(mode: DiscoverMode, genreId?: number): Promise<MovieResult[]> {
  if (!tmdbEnabled) return [];
  try {
    // Trending with no genre filter uses TMDB's trending feed directly.
    if (mode === "trending" && !genreId) {
      return mapResults(await tmdbFetch("/trending/movie/week"), 18);
    }
    const params: Record<string, string> = { include_adult: "false", page: "1", "vote_count.gte": "200" };
    if (genreId) params.with_genres = String(genreId);
    params.sort_by = mode === "top_rated" ? "vote_average.desc" : "popularity.desc";
    if (mode === "top_rated") params["vote_count.gte"] = "500"; // avoid obscure 10/10s
    return mapResults(await tmdbFetch("/discover/movie", params), 18);
  } catch (err) {
    logger.warn({ err: String(err) }, "TMDB discover failed");
    throw new Error("Movie browsing is temporarily unavailable");
  }
}
