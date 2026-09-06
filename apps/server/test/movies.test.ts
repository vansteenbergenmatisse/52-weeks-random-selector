import { describe, it, expect, beforeEach } from "vitest";
import { pickBestMatch } from "../src/features/movies/tmdb.js";
import { reconcileAiPicks, sanitizeDetection, type AiMatchRow } from "../src/features/movies/aiMatch.js";
import { createEntriesBulk } from "../src/features/entries/service.js";
import { prisma } from "../src/platform/db/prisma.js";
import { resetDb, makeCouple } from "./helpers.js";
import type { MovieResult } from "../src/features/movies/tmdb.js";

const M = (over: Partial<MovieResult>): MovieResult => ({
  tmdbId: 1,
  title: "X",
  releaseYear: null,
  overview: "",
  posterPath: null,
  backdropPath: null,
  rating: null,
  ...over,
});

describe("pickBestMatch", () => {
  it("returns null when there are no results", () => {
    expect(pickBestMatch("Anything", null, [])).toBeNull();
  });

  it("keeps TMDB popularity order when nothing scores higher", () => {
    const results = [M({ tmdbId: 1, title: "Popular but wrong" }), M({ tmdbId: 2, title: "Also wrong" })];
    expect(pickBestMatch("Totally different", null, results)?.tmdbId).toBe(1);
  });

  it("prefers an exact title match over the top popularity result", () => {
    const results = [M({ tmdbId: 1, title: "The Batman Spoof" }), M({ tmdbId: 2, title: "Batman" })];
    expect(pickBestMatch("Batman", null, results)?.tmdbId).toBe(2);
  });

  it("uses the year to disambiguate same-titled films", () => {
    const results = [
      M({ tmdbId: 1, title: "The Batman", releaseYear: 1966 }),
      M({ tmdbId: 2, title: "The Batman", releaseYear: 2022 }),
    ];
    expect(pickBestMatch("The Batman", 2022, results)?.tmdbId).toBe(2);
  });
});

describe("reconcileAiPicks", () => {
  const row = (candidateIds: number[]): AiMatchRow => ({
    query: "q",
    year: null,
    candidates: candidateIds.map((id) => M({ tmdbId: id })),
  });

  it("accepts an id that exists in that row's candidates", () => {
    const rows = [row([10, 20, 30])];
    expect(reconcileAiPicks(rows, [{ i: 0, id: 20 }])).toEqual([20]);
  });

  it("rejects a hallucinated id not among the candidates", () => {
    const rows = [row([10, 20])];
    expect(reconcileAiPicks(rows, [{ i: 0, id: 999 }])).toEqual([null]);
  });

  it("treats an explicit null verdict as no match", () => {
    const rows = [row([10, 20])];
    expect(reconcileAiPicks(rows, [{ i: 0, id: null }])).toEqual([null]);
  });

  it("returns null for rows with no candidates and for missing verdicts", () => {
    const rows = [row([]), row([10])];
    // no verdict for index 1 at all
    expect(reconcileAiPicks(rows, [{ i: 0, id: 5 }])).toEqual([null, null]);
  });

  it("aligns verdicts to rows by index regardless of order", () => {
    const rows = [row([1]), row([2]), row([3])];
    expect(reconcileAiPicks(rows, [{ i: 2, id: 3 }, { i: 0, id: 1 }])).toEqual([1, null, 3]);
  });
});

describe("sanitizeDetection", () => {
  it("accepts an in-range title column and coerces the rest", () => {
    expect(sanitizeDetection({ hasHeader: true, titleCol: 1, yearCol: 2, notesCol: null }, 3)).toEqual({
      hasHeader: true,
      titleCol: 1,
      yearCol: 2,
      notesCol: null,
    });
  });

  it("returns null when the title column is missing or out of range", () => {
    expect(sanitizeDetection({ hasHeader: true, titleCol: null }, 3)).toBeNull();
    expect(sanitizeDetection({ titleCol: 9 }, 3)).toBeNull(); // index 9 in a 3-col sheet
    expect(sanitizeDetection({ titleCol: 1.5 }, 3)).toBeNull(); // non-integer
    expect(sanitizeDetection("nonsense", 3)).toBeNull();
  });

  it("nulls out-of-range year/notes columns but keeps a valid title", () => {
    expect(sanitizeDetection({ titleCol: 0, yearCol: 99, notesCol: -1 }, 2)).toEqual({
      hasHeader: false,
      titleCol: 0,
      yearCol: null,
      notesCol: null,
    });
  });
});

describe("createEntriesBulk — movie metadata", () => {
  beforeEach(resetDb);

  it("persists tmdbId/poster for movie rows and ignores them for date rows", async () => {
    const { couple, a, dates, movies } = await makeCouple();

    await createEntriesBulk(couple.id, movies.id, a.id, [
      { title: "The Matrix", tmdbId: 603, posterPath: "/matrix.jpg", backdropPath: "/bd.jpg", releaseYear: 1999 },
      { title: "Handwritten pick" }, // "as text" row — no tmdbId
    ]);
    await createEntriesBulk(couple.id, dates.id, a.id, [
      { title: "Picnic", tmdbId: 999, posterPath: "/nope.jpg" }, // movie fields must be dropped for dates
    ]);

    const movieRows = await prisma.entry.findMany({ where: { collectionId: movies.id } });
    const linked = movieRows.find((e) => e.title === "The Matrix")!;
    expect(linked.tmdbId).toBe(603);
    expect(linked.posterPath).toBe("/matrix.jpg");
    const text = movieRows.find((e) => e.title === "Handwritten pick")!;
    expect(text.tmdbId).toBeNull();
    expect(text.posterPath).toBeNull();

    const dateRows = await prisma.entry.findMany({ where: { collectionId: dates.id } });
    const picnic = dateRows.find((e) => e.title === "Picnic")!;
    expect(picnic.tmdbId).toBeNull();
    expect(picnic.posterPath).toBeNull();
  });
});
