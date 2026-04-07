/**
 * Parse x-ratelimit-* response headers returned by providers
 * (Groq, Cerebras, OpenAI, Google, etc.) and return a normalised update object.
 */

export interface RateLimitHeaderUpdate {
  remainingRequests?: number;
  remainingTokens?: number;
  resetRequests?: number;  // unix timestamp (ms)
  resetTokens?: number;    // unix timestamp (ms)
}

/**
 * Parse a "reset" header value into a unix timestamp (ms).
 * Providers use different formats:
 *   - ISO 8601: "2024-01-01T00:01:00Z"
 *   - Relative seconds: "60"  (seconds from now)
 *   - Relative with unit: "1m30s", "500ms"
 */
function parseResetTime(value: string): number | undefined {
  if (!value) return undefined;

  // Unix timestamp (numeric)
  const numeric = Number(value);
  if (!isNaN(numeric)) {
    // If it looks like a large Unix timestamp (>= 10^9) use as-is
    if (numeric > 1_000_000_000) return numeric * 1000;
    // Otherwise treat as seconds from now
    return Date.now() + numeric * 1000;
  }

  // ISO 8601 / RFC 3339
  const date = new Date(value);
  if (!isNaN(date.getTime())) return date.getTime();

  // Duration string like "1m30s", "500ms", "2h"
  const durationRe = /(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?(?:(\d+)ms)?/;
  const m = durationRe.exec(value);
  if (m) {
    const h = parseInt(m[1] ?? "0") || 0;
    const min = parseInt(m[2] ?? "0") || 0;
    const s = parseFloat(m[3] ?? "0") || 0;
    const ms = parseInt(m[4] ?? "0") || 0;
    const totalMs = h * 3_600_000 + min * 60_000 + s * 1_000 + ms;
    if (totalMs > 0) return Date.now() + totalMs;
  }

  return undefined;
}

export function parseRateLimitHeaders(headers: Headers): RateLimitHeaderUpdate {
  const update: RateLimitHeaderUpdate = {};

  // Standard x-ratelimit-remaining-requests
  const remReq =
    headers.get("x-ratelimit-remaining-requests") ??
    headers.get("x-ratelimit-remaining") ??
    headers.get("ratelimit-remaining");
  if (remReq !== null) {
    const n = parseInt(remReq);
    if (!isNaN(n)) update.remainingRequests = n;
  }

  // Standard x-ratelimit-remaining-tokens
  const remTok = headers.get("x-ratelimit-remaining-tokens");
  if (remTok !== null) {
    const n = parseInt(remTok);
    if (!isNaN(n)) update.remainingTokens = n;
  }

  // Reset times
  const resetReq =
    headers.get("x-ratelimit-reset-requests") ??
    headers.get("x-ratelimit-reset") ??
    headers.get("ratelimit-reset");
  if (resetReq !== null) {
    const t = parseResetTime(resetReq);
    if (t !== undefined) update.resetRequests = t;
  }

  const resetTok = headers.get("x-ratelimit-reset-tokens");
  if (resetTok !== null) {
    const t = parseResetTime(resetTok);
    if (t !== undefined) update.resetTokens = t;
  }

  return update;
}
