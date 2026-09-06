import { env } from "../../platform/config/env.js";
import type { CurrentState } from "../selection/service.js";

type Coll = { id: string; name: string; kind: string };

const emojiFor = (kind: string) => (kind === "movies" ? "🎬" : "❤️");
const singular = (name: string) => name.toLowerCase().replace(/s$/, "");

export function collectionUrl(collectionId: string): string {
  return `${env.APP_BASE_URL}/app?collection=${collectionId}`;
}

export function formatResultMessage(state: CurrentState, collection: Coll): string {
  const r = state.result;
  if (!r) return formatReminder(collection);
  const lines = [`${emojiFor(collection.kind)} This week's ${singular(collection.name)}: ${r.title}`, `Added by ${r.contributor}`];
  if (r.location) lines.push(`📍 ${r.location}`);
  if (r.description) lines.push("", r.description);
  lines.push(
    "",
    "Not feeling it? React 🔄 (or reply REROLL) and I'll pick another.",
    "Done it? React ✅ (or reply DONE).",
    "",
    `Open Our 52: ${collectionUrl(collection.id)}`,
  );
  return lines.join("\n");
}

export function formatReroll(state: CurrentState, collection: Coll): string {
  const r = state.result;
  if (!r) return formatReminder(collection);
  const lines = [`🔄 New ${singular(collection.name)} for this week: ${r.title}`, `Added by ${r.contributor}`];
  if (r.location) lines.push(`📍 ${r.location}`);
  lines.push("", `Open Our 52: ${collectionUrl(collection.id)}`);
  return lines.join("\n");
}

export function formatReminder(collection: { id: string; name: string }): string {
  return [
    `⏰ Time to pick this week's ${singular(collection.name)}!`,
    "Nobody's spun yet — open Our 52 and give the wheel a whirl:",
    collectionUrl(collection.id),
  ].join("\n");
}

/** Second message inviting a 👍 to book the pick into both calendars. */
export function formatCalendarPrompt(state: CurrentState, collection: Coll, whenText: string): string {
  const r = state.result;
  if (!r) return "";
  const lines = [`📅 Add "${r.title}" to your calendars?`, whenText];
  if (r.location) lines.push(`📍 ${r.location}`);
  lines.push("", "Give this message a 👍 and I'll add it for both of you.");
  return lines.join("\n");
}

export function formatCalendarBooked(title: string): string {
  return `📅 Booked! "${title}" is on both your calendars. Check your inbox for the invite.`;
}

export function formatNoAlternative(collection: { name: string }): string {
  return `There's no other idea in ${collection.name} right now, so I kept this week's pick. Add a few more to enable rerolls.`;
}

export function formatAmbiguous(collections: { name: string }[]): string {
  const names = collections.map((c) => c.name.toUpperCase()).join(" or ");
  return `Which one? Reply "REROLL ${names.split(" or ")[0]}" (e.g. REROLL ${names})`;
}
