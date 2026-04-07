/**
 * Rate limit system tests.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { parseRateLimitHeaders } from "../src/ratelimit/headers.js";
import { estimateChatTokens, estimateCompletionTokens } from "../src/ratelimit/estimator.js";
import { clearConfigCache } from "../src/config/loader.js";

// ── Header parsing ─────────────────────────────────────────────────────────────

describe("parseRateLimitHeaders", () => {
  it("parses x-ratelimit-remaining-requests", () => {
    const headers = new Headers({ "x-ratelimit-remaining-requests": "42" });
    const result = parseRateLimitHeaders(headers);
    expect(result.remainingRequests).toBe(42);
  });

  it("parses x-ratelimit-remaining-tokens", () => {
    const headers = new Headers({ "x-ratelimit-remaining-tokens": "5000" });
    const result = parseRateLimitHeaders(headers);
    expect(result.remainingTokens).toBe(5000);
  });

  it("parses ISO 8601 reset time", () => {
    const future = new Date(Date.now() + 60000).toISOString();
    const headers = new Headers({ "x-ratelimit-reset-requests": future });
    const result = parseRateLimitHeaders(headers);
    expect(result.resetRequests).toBeGreaterThan(Date.now());
  });

  it("parses relative seconds reset time", () => {
    const before = Date.now();
    const headers = new Headers({ "x-ratelimit-reset": "60" });
    const result = parseRateLimitHeaders(headers);
    expect(result.resetRequests).toBeGreaterThan(before + 55000);
    expect(result.resetRequests).toBeLessThan(before + 65000);
  });

  it("parses duration string reset time", () => {
    const before = Date.now();
    const headers = new Headers({ "x-ratelimit-reset": "1m30s" });
    const result = parseRateLimitHeaders(headers);
    expect(result.resetRequests).toBeGreaterThan(before + 85000);
    expect(result.resetRequests).toBeLessThan(before + 95000);
  });

  it("returns empty object for missing headers", () => {
    const headers = new Headers();
    const result = parseRateLimitHeaders(headers);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("falls back to ratelimit-remaining", () => {
    const headers = new Headers({ "ratelimit-remaining": "10" });
    const result = parseRateLimitHeaders(headers);
    expect(result.remainingRequests).toBe(10);
  });
});

// ── Token estimator ───────────────────────────────────────────────────────────

describe("estimateChatTokens", () => {
  it("returns positive number for single user message", () => {
    const messages = [{ role: "user" as const, content: "Hello world" }];
    const tokens = estimateChatTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });

  it("increases with message length", () => {
    const short = [{ role: "user" as const, content: "Hi" }];
    const long = [{ role: "user" as const, content: "A".repeat(1000) }];
    const shortTokens = estimateChatTokens(short);
    const longTokens = estimateChatTokens(long);
    expect(longTokens).toBeGreaterThan(shortTokens);
  });

  it("includes max_tokens in estimate", () => {
    const messages = [{ role: "user" as const, content: "Hello" }];
    const low = estimateChatTokens(messages, 100);
    const high = estimateChatTokens(messages, 2000);
    expect(high).toBeGreaterThan(low);
  });

  it("handles array content parts", () => {
    const messages = [
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: "Describe this image" }],
      },
    ];
    const tokens = estimateChatTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });

  it("handles null content", () => {
    const messages = [{ role: "assistant" as const, content: null }];
    const tokens = estimateChatTokens(messages);
    expect(tokens).toBeGreaterThan(0); // at least overhead + default max_tokens
  });
});

describe("estimateCompletionTokens", () => {
  it("estimates tokens for a string prompt", () => {
    const tokens = estimateCompletionTokens("Hello, how are you?");
    expect(tokens).toBeGreaterThan(0);
  });

  it("estimates tokens for array prompt", () => {
    const tokens = estimateCompletionTokens(["Hello", "World"]);
    expect(tokens).toBeGreaterThan(0);
  });

  it("includes max_tokens", () => {
    const low = estimateCompletionTokens("test", 100);
    const high = estimateCompletionTokens("test", 2000);
    expect(high).toBeGreaterThan(low);
  });
});
