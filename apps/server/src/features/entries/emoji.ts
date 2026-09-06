import { env, emojiAiEnabled } from "../../platform/config/env.js";
import { logger } from "../../platform/logger/logger.js";

/**
 * Auto-pick an emoji for a date idea. Uses Claude when ANTHROPIC_API_KEY is set,
 * otherwise a small keyword map. Always resolves (never throws) — a missing key,
 * timeout, or bad response falls back so adding an idea never blocks or fails.
 */

const FALLBACK_DEFAULT = "❤️";
const KEYWORD_MAP: Array<[RegExp, string]> = [
  [/picnic|market/, "🧺"],
  [/cocktail|bar\b|drinks?/, "🍸"],
  [/wine/, "🍷"],
  [/coffee|café|cafe/, "☕"],
  [/brunch|pancake|breakfast|diner/, "🥞"],
  [/dinner|restaurant|cook|recipe|food|eat/, "🍽️"],
  [/movie|cinema|film/, "🎬"],
  [/hike|mountain|trail|climb/, "🥾"],
  [/beach|ocean|sea\b|swim/, "🏖️"],
  [/dance|dancing/, "💃"],
  [/karaoke|sing|concert|music|gig/, "🎤"],
  [/museum|art|gallery|paint/, "🖼️"],
  [/book|read|library/, "📚"],
  [/board ?game|game|arcade/, "🎲"],
  [/spa|massage|sauna/, "🧖"],
  [/star|night sky|astro/, "🌌"],
  [/sunset|sunrise/, "🌅"],
  [/bike|cycl/, "🚲"],
  [/walk|stroll/, "🚶"],
  [/pottery|ceramic/, "🏺"],
  [/travel|trip|road ?trip|weekend away/, "✈️"],
  [/park|garden|nature/, "🌳"],
  [/bake|dessert|cake|ice ?cream/, "🧁"],
  [/photo|shoot/, "📷"],
  [/picnic|blanket/, "🧺"],
];

function keywordEmoji(title: string): string {
  const t = title.toLowerCase();
  for (const [re, emoji] of KEYWORD_MAP) if (re.test(t)) return emoji;
  return FALLBACK_DEFAULT;
}

/** Extract the first emoji from arbitrary model text, or null if none is usable. */
function firstEmoji(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // If the whole reply is short and has no letters/digits, trust it verbatim.
  if (trimmed.length <= 8 && !/[a-z0-9]/i.test(trimmed)) return trimmed;
  const m = trimmed.match(/\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*/u);
  return m ? m[0] : null;
}

async function callClaude(prompt: string, maxTokens: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Emoji AI call failed; using fallback");
      return null;
    }
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    return data.content?.map((c) => c.text ?? "").join("") ?? null;
  } catch (err) {
    logger.warn({ err: String(err) }, "Emoji AI call errored; using fallback");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function pickEmoji(title: string): Promise<string> {
  if (!emojiAiEnabled) return keywordEmoji(title);
  const text = await callClaude(
    `Pick ONE emoji that best represents this date idea. Reply with only the emoji, nothing else.\n\nIdea: "${title.slice(0, 120)}"`,
    8,
  );
  return (text && firstEmoji(text)) || keywordEmoji(title);
}

/** Batch variant: one model call for many titles. Falls back per-item on any issue. */
export async function pickEmojis(titles: string[]): Promise<string[]> {
  if (titles.length === 0) return [];
  if (!emojiAiEnabled) return titles.map(keywordEmoji);

  const list = titles.map((t, i) => `${i + 1}. ${t.slice(0, 120)}`).join("\n");
  const text = await callClaude(
    `For each date idea below, pick ONE emoji that best represents it. ` +
      `Return ONLY a JSON array of emoji strings, in the same order, no other text.\n\n${list}`,
    Math.min(400, titles.length * 12 + 20),
  );
  if (text) {
    try {
      const jsonStart = text.indexOf("[");
      const jsonEnd = text.lastIndexOf("]");
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        const arr = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as unknown[];
        if (Array.isArray(arr) && arr.length === titles.length) {
          return titles.map((t, i) => firstEmoji(String(arr[i] ?? "")) || keywordEmoji(t));
        }
      }
    } catch {
      /* fall through to keyword */
    }
  }
  return titles.map(keywordEmoji);
}
