/**
 * One-off: fill in poster/backdrop/TMDB/IMDb for movie entries that were added
 * before a TMDB key existed. Matches by title (preferring the release year).
 * Run: pnpm --filter @our52/server exec tsx scripts/backfill-movie-art.ts
 */
import { prisma } from "../src/platform/db/prisma.js";
import { tmdbEnabled } from "../src/platform/config/env.js";
import { searchMovies, getImdbId } from "../src/features/movies/tmdb.js";

async function main() {
  if (!tmdbEnabled) {
    console.log("No TMDB_API_KEY set — nothing to backfill.");
    return;
  }
  const movies = await prisma.entry.findMany({
    where: { collection: { kind: "movies" }, deletedAt: null, posterPath: null },
  });
  console.log(`Backfilling ${movies.length} movie(s)…`);

  for (const m of movies) {
    const results = await searchMovies(m.title).catch(() => []);
    if (results.length === 0) {
      console.log(`  ✗ no match for "${m.title}"`);
      continue;
    }
    const best = (m.releaseYear && results.find((r) => r.releaseYear === m.releaseYear)) || results[0]!;
    const imdbId = await getImdbId(best.tmdbId);
    await prisma.entry.update({
      where: { id: m.id },
      data: {
        tmdbId: best.tmdbId,
        imdbId,
        posterPath: best.posterPath,
        backdropPath: best.backdropPath,
        releaseYear: best.releaseYear ?? m.releaseYear,
      },
    });
    console.log(`  ✓ ${m.title} → ${best.title} (${best.releaseYear ?? "?"}) ${imdbId ?? ""}`);
  }
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
