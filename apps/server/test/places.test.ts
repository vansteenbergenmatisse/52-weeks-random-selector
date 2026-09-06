import { describe, it, expect } from "vitest";
import {
  PLACE_CATEGORIES,
  buildOverpassQuery,
  formatAddress,
  mapOverpass,
} from "../src/features/places/osm.js";

const drinks = PLACE_CATEGORIES.find((c) => c.key === "drinks")!;

describe("buildOverpassQuery", () => {
  it("collapses same-key tags into one regex clause per key (node+way), scoped to radius/centre", () => {
    const q = buildOverpassQuery(drinks, 40.78, -73.97, 3000);
    // drinks are all amenity=* → one key → one node + one way clause
    expect(q.match(/node\[/g)).toHaveLength(1);
    expect(q.match(/way\[/g)).toHaveLength(1);
    expect(q).toContain('node["amenity"~"^(bar|pub|biergarten|nightclub)$"]["name"](around:3000,40.78,-73.97);');
    expect(q).toContain("out center 40;");
  });

  it("keeps distinct keys as separate clauses and uses exact match for a single value", () => {
    const adventure = PLACE_CATEGORIES.find((c) => c.key === "adventure")!;
    const q = buildOverpassQuery(adventure, 1, 2, 3000);
    // adventure spans leisure, sport, tourism → 3 keys → 3 node + 3 way clauses
    expect(q.match(/node\[/g)).toHaveLength(3);
    // sport has a single value → exact match, not a regex
    expect(q).toContain('"sport"="climbing"');
  });
});

describe("formatAddress", () => {
  it("combines house number, street and city", () => {
    expect(
      formatAddress({ "addr:housenumber": "12", "addr:street": "Main St", "addr:city": "NYC" }),
    ).toBe("12 Main St, NYC");
  });

  it("returns null when there is nothing useful", () => {
    expect(formatAddress({ opening_hours: "24/7" })).toBeNull();
  });
});

describe("mapOverpass", () => {
  const fixture = {
    elements: [
      { type: "node", id: 1, lat: 40.78, lon: -73.97, tags: { name: "The Dead Rabbit", amenity: "bar" } },
      // way with a center block instead of top-level lat/lon
      { type: "way", id: 2, center: { lat: 40.79, lon: -73.96 }, tags: { name: "Employees Only", amenity: "bar" } },
      // unnamed → skipped
      { type: "node", id: 3, lat: 40.7, lon: -73.9, tags: { amenity: "bar" } },
      // duplicate name → skipped
      { type: "node", id: 4, lat: 40.71, lon: -73.91, tags: { name: "The Dead Rabbit", amenity: "bar" } },
    ],
  };

  it("keeps named places, resolves way centres, and de-duplicates by name", () => {
    const out = mapOverpass(fixture, "drinks");
    expect(out).toHaveLength(2);
    expect(out.map((p) => p.name)).toEqual(["The Dead Rabbit", "Employees Only"]);
    expect(out[1].lat).toBe(40.79);
    expect(out[0].category).toBe("drinks");
    expect(out[0].mapUrl).toContain("openstreetmap.org");
  });

  it("respects the limit", () => {
    expect(mapOverpass(fixture, "drinks", 1)).toHaveLength(1);
  });
});
