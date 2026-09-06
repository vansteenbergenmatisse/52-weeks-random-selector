import { env } from "../config/env.js";
import { logger } from "../logger/logger.js";

/**
 * Minimal Claude Messages API call. Returns the concatenated text, or null on
 * any failure (missing key, timeout, non-2xx) so callers can fall back cleanly.
 */
export async function callClaude(prompt: string, maxTokens: number, timeoutMs = 8000): Promise<string | null> {
  if (!env.ANTHROPIC_API_KEY) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
      logger.warn({ status: res.status }, "Claude call failed; using fallback");
      return null;
    }
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    return data.content?.map((c) => c.text ?? "").join("") ?? null;
  } catch (err) {
    logger.warn({ err: String(err) }, "Claude call errored; using fallback");
    return null;
  } finally {
    clearTimeout(timer);
  }
}
