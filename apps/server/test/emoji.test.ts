import { describe, it, expect } from "vitest";
import { pickEmoji, pickEmojis } from "../src/features/entries/emoji.js";
import { suggestEmojis } from "../src/features/entries/service.js";

// No ANTHROPIC_API_KEY under test → the keyword fallback path is exercised.
describe("auto-emoji fallback", () => {
  it("maps recognisable keywords", async () => {
    expect(await pickEmoji("Sunset picnic")).toBe("🧺");
    expect(await pickEmoji("Cocktail bar night")).toBe("🍸");
    expect(await pickEmoji("Hike the hills")).toBe("🥾");
  });

  it("falls back to a heart for anything unrecognised", async () => {
    expect(await pickEmoji("Zqxwv blorp")).toBe("❤️");
  });

  it("batch returns exactly one emoji per title, in order", async () => {
    const out = await pickEmojis(["Movie night at home", "Museum wander", "Zzz"]);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe("🎬");
    expect(out[1]).toBe("🖼️");
    expect(out[2]).toBe("❤️");
  });
});

describe("suggestEmojis (import preview)", () => {
  it("suggests one emoji per title, in order", async () => {
    const out = await suggestEmojis(["Sunset picnic", "Cocktail bar night"]);
    expect(out).toEqual(["🧺", "🍸"]);
  });

  it("ignores blank titles and returns empty for none", async () => {
    expect(await suggestEmojis([])).toEqual([]);
    expect(await suggestEmojis(["   ", ""])).toEqual([]);
  });
});
