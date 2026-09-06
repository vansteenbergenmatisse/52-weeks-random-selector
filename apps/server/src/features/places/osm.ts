import { logger } from "../../platform/logger/logger.js";

// OpenStreetMap-powered activity discovery — free, keyless.
// Nominatim geocodes an area name ("Manhattan") to a centre point; Overpass
// then returns named points-of-interest of a chosen category nearby.
// OSM usage policy asks for a descriptive User-Agent and light traffic, so we
// send one and keep a small in-memory geocode cache.

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
// The main overpass-api.de instance is frequently overloaded; try faster
// community mirrors in order until one answers.
const OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const USER_AGENT = "Our52/1.0 (private couples activity app)";
const SEARCH_RADIUS_M = 3000;
const OVERPASS_TIMEOUT_MS = 15000;

export interface PlaceCategory {
  key: string;
  label: string;
  /** OSM tag filters; a POI matches the category if it carries any one of these key=value tags. */
  filters: { k: string; v: string }[];
}

export interface PlaceResult {
  name: string;
  category: string;
  address: string | null;
  lat: number;
  lon: number;
  mapUrl: string;
}

// Curated, couple-friendly categories mapped to OSM tags.
export const PLACE_CATEGORIES: PlaceCategory[] = [
  {
    key: "culture",
    label: "🖼️ Museums & culture",
    filters: [
      { k: "tourism", v: "museum" },
      { k: "tourism", v: "gallery" },
      { k: "amenity", v: "arts_centre" },
      { k: "amenity", v: "theatre" },
    ],
  },
  {
    key: "food",
    label: "🍽️ Food & dining",
    filters: [
      { k: "amenity", v: "restaurant" },
      { k: "amenity", v: "cafe" },
    ],
  },
  {
    key: "drinks",
    label: "🍸 Drinks & nightlife",
    filters: [
      { k: "amenity", v: "bar" },
      { k: "amenity", v: "pub" },
      { k: "amenity", v: "biergarten" },
      { k: "amenity", v: "nightclub" },
    ],
  },
  {
    key: "adventure",
    label: "🧗 Adventure & active",
    filters: [
      { k: "leisure", v: "climbing" },
      { k: "sport", v: "climbing" },
      { k: "leisure", v: "escape_game" },
      { k: "tourism", v: "theme_park" },
      { k: "leisure", v: "trampoline_park" },
      { k: "leisure", v: "bowling_alley" },
    ],
  },
  {
    key: "outdoors",
    label: "🌳 Outdoors & parks",
    filters: [
      { k: "leisure", v: "park" },
      { k: "leisure", v: "garden" },
      { k: "tourism", v: "viewpoint" },
      { k: "natural", v: "beach" },
    ],
  },
  {
    key: "wellness",
    label: "💆 Wellness & relax",
    filters: [
      { k: "leisure", v: "spa" },
      { k: "amenity", v: "spa" },
      { k: "leisure", v: "sauna" },
    ],
  },
];

export function placesStatus() {
  return {
    enabled: true,
    attribution: "Place data © OpenStreetMap contributors (ODbL).",
    note: "Activity search is powered by OpenStreetMap — no API key needed.",
  };
}

/**
 * Build an Overpass QL query for a category's tags within radius of a centre.
 * Tags sharing a key are collapsed into a single regex clause (e.g.
 * amenity~"^(bar|pub)$") so dense areas resolve in one cheap pass instead of
 * one lookup per value.
 */
export function buildOverpassQuery(
  category: PlaceCategory,
  lat: number,
  lon: number,
  radius = SEARCH_RADIUS_M,
): string {
  const around = `around:${radius},${lat},${lon}`;
  const byKey = new Map<string, string[]>();
  for (const { k, v } of category.filters) {
    byKey.set(k, [...(byKey.get(k) ?? []), v]);
  }
  const clauses = [...byKey.entries()]
    .flatMap(([k, vs]) => {
      const match = vs.length === 1 ? `"${k}"="${vs[0]}"` : `"${k}"~"^(${vs.join("|")})$"`;
      return [`node[${match}]["name"](${around});`, `way[${match}]["name"](${around});`];
    })
    .join("\n  ");
  return `[out:json][timeout:25];\n(\n  ${clauses}\n);\nout center 40;`;
}

/** Compose a human-readable address from OSM addr:* tags, or null if too sparse. */
export function formatAddress(tags: Record<string, unknown>): string | null {
  const house = tags["addr:housenumber"];
  const street = tags["addr:street"];
  const city = tags["addr:city"];
  const parts: string[] = [];
  if (street) parts.push([house, street].filter(Boolean).join(" "));
  if (city) parts.push(String(city));
  return parts.length ? parts.join(", ") : null;
}

/** Map a raw Overpass response into named, de-duplicated PlaceResults. */
export function mapOverpass(data: unknown, categoryKey: string, limit = 30): PlaceResult[] {
  const elements = (data as { elements?: unknown[] })?.elements ?? [];
  const seen = new Set<string>();
  const out: PlaceResult[] = [];
  for (const raw of elements) {
    const el = raw as Record<string, unknown>;
    const tags = (el.tags as Record<string, unknown>) ?? {};
    const name = typeof tags.name === "string" ? tags.name.trim() : "";
    if (!name) continue;
    // ways carry a `center`; nodes carry lat/lon directly.
    const center = el.center as { lat?: number; lon?: number } | undefined;
    const lat = Number(el.lat ?? center?.lat);
    const lon = Number(el.lon ?? center?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      category: categoryKey,
      address: formatAddress(tags),
      lat,
      lon,
      mapUrl: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`,
    });
    if (out.length >= limit) break;
  }
  return out;
}

interface GeoPoint {
  lat: number;
  lon: number;
  displayName: string;
}

const geocodeCache = new Map<string, GeoPoint | null>();

async function geocodeArea(area: string): Promise<GeoPoint | null> {
  const key = area.trim().toLowerCase();
  if (geocodeCache.has(key)) return geocodeCache.get(key) ?? null;

  const url = new URL(NOMINATIM);
  url.searchParams.set("q", area.trim());
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const rows = (await res.json()) as Array<{ lat?: string; lon?: string; display_name?: string }>;
    const first = rows[0];
    const lat = Number(first?.lat);
    const lon = Number(first?.lon);
    if (!first || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      geocodeCache.set(key, null);
      return null;
    }
    const point: GeoPoint = { lat, lon, displayName: first.display_name ?? area };
    geocodeCache.set(key, point);
    return point;
  } catch (err) {
    logger.warn({ err: String(err) }, "Nominatim geocode failed");
    throw new Error("Couldn't look up that area right now");
  }
}

/** Find named POIs of a category near an area. Returns [] for an unknown area. */
export async function searchPlaces(
  area: string,
  categoryKey: string,
): Promise<{ area: string | null; results: PlaceResult[] }> {
  const category = PLACE_CATEGORIES.find((c) => c.key === categoryKey);
  if (!category) throw new Error("Unknown category");
  if (!area.trim()) return { area: null, results: [] };

  const point = await geocodeArea(area);
  if (!point) return { area: null, results: [] };

  const query = buildOverpassQuery(category, point.lat, point.lon);
  let lastErr: unknown;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const data = await res.json();
      return { area: point.displayName, results: mapOverpass(data, categoryKey) };
    } catch (err) {
      lastErr = err;
      logger.warn({ err: String(err), endpoint }, "Overpass endpoint failed, trying next");
    }
  }
  logger.warn({ err: String(lastErr) }, "All Overpass endpoints failed");
  throw new Error("Place search is temporarily unavailable");
}
