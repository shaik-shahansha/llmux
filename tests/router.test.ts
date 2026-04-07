/**
 * Router strategy tests.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { byPriority } from "../src/router/strategies/priority.js";
import { latencyBased } from "../src/router/strategies/latency-based.js";
import { randomWeighted } from "../src/router/strategies/random-weighted.js";
import { roundRobin } from "../src/router/strategies/round-robin.js";
import { leastBusy } from "../src/router/strategies/least-busy.js";
import type { IProvider, ProviderConfig, ProviderHealth, RateLimitState, RequestContext } from "../src/types/provider.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeProvider(
  id: string,
  tier: 1 | 2 | 3 | 4,
  status: ProviderHealth["status"] = "healthy",
  latencyMs?: number
): IProvider {
  const config: ProviderConfig = {
    id,
    name: id,
    modality: "text",
    tier,
    enabled: true,
    requiresAuth: false,
    baseUrl: "https://example.com",
    adapter: "openai",
    models: [{ id: "test-model" }],
    limits: {},
    concurrency: 5,
    timeout: 30000,
    maxRetries: 2,
  };

  const health: ProviderHealth = {
    status,
    latencyMs,
    consecutiveErrors: 0,
  };

  const rateLimitState: RateLimitState = {
    rpm: 0, rpd: 0, tpm: 0, tpd: 0,
    requestsThisMinute: 0, requestsToday: 0,
    tokensThisMinute: 0, tokensToday: 0,
    minuteWindowStart: Date.now(),
    dayWindowStart: Date.now(),
  };

  return {
    config,
    health,
    rateLimitState,
    canHandle: () => true,
    chatCompletion: async () => new Response("{}"),
    ping: async () => true,
    rateLimitTracker: {
      canSend: async () => ({ allowed: true }),
      recordSuccess: async () => {},
      recordRateLimitError: async () => {},
      recordError: async () => {},
      applyHeaderUpdates: async () => {},
      getState: async () => rateLimitState,
    } as any,
  };
}

// ── Priority strategy ──────────────────────────────────────────────────────────

describe("byPriority", () => {
  it("returns null for empty list", () => {
    expect(byPriority([])).toBeNull();
  });

  it("selects tier 1 over tier 2", () => {
    const t1 = makeProvider("t1", 1);
    const t2 = makeProvider("t2", 2);
    expect(byPriority([t2, t1])?.config.id).toBe("t1");
  });

  it("tie-breaks by latency", () => {
    const a = makeProvider("a", 1, "healthy", 500);
    const b = makeProvider("b", 1, "healthy", 100);
    expect(byPriority([a, b])?.config.id).toBe("b");
  });

  it("returns single provider", () => {
    const p = makeProvider("only", 1);
    expect(byPriority([p])?.config.id).toBe("only");
  });
});

// ── Latency strategy ───────────────────────────────────────────────────────────

describe("latencyBased", () => {
  it("returns null for empty list", () => {
    expect(latencyBased([])).toBeNull();
  });

  it("selects the provider with lowest latency", () => {
    const fast = makeProvider("fast", 2, "healthy", 50);
    const slow = makeProvider("slow", 1, "healthy", 500);
    expect(latencyBased([slow, fast])?.config.id).toBe("fast");
  });

  it("falls back to first provider when no latency data", () => {
    const a = makeProvider("a", 1, "unknown");
    const b = makeProvider("b", 2, "unknown");
    const result = latencyBased([a, b]);
    expect(result).not.toBeNull();
  });
});

// ── Random-weighted strategy ───────────────────────────────────────────────────

describe("randomWeighted", () => {
  it("returns null for empty list", () => {
    expect(randomWeighted([])).toBeNull();
  });

  it("returns the only provider when list has one", () => {
    const p = makeProvider("only", 1);
    expect(randomWeighted([p])?.config.id).toBe("only");
  });

  it("returns one of the providers", () => {
    const providers = [makeProvider("a", 1), makeProvider("b", 2), makeProvider("c", 3)];
    const result = randomWeighted(providers);
    expect(providers.map(p => p.config.id)).toContain(result?.config.id);
  });

  it("over 100 runs, all providers get selected at least once", () => {
    const providers = [makeProvider("a", 1), makeProvider("b", 2), makeProvider("c", 3)];
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 100; i++) {
      const p = randomWeighted(providers);
      if (p) counts[p.config.id]++;
    }
    expect(counts["a"]).toBeGreaterThan(0);
    expect(counts["b"]).toBeGreaterThan(0);
    expect(counts["c"]).toBeGreaterThan(0);
  });

  it("tier 1 is selected more often than tier 4", () => {
    const t1 = makeProvider("t1", 1);
    const t4 = makeProvider("t4", 4);
    const counts: Record<string, number> = { t1: 0, t4: 0 };
    for (let i = 0; i < 500; i++) {
      const p = randomWeighted([t1, t4]);
      if (p) counts[p.config.id]++;
    }
    expect(counts["t1"]).toBeGreaterThan(counts["t4"]);
  });
});

// ── Round-robin strategy ───────────────────────────────────────────────────────

describe("roundRobin", () => {
  it("returns null for empty list", () => {
    expect(roundRobin([], "test")).toBeNull();
  });

  it("cycles through providers", () => {
    const providers = [
      makeProvider("a", 1),
      makeProvider("b", 2),
      makeProvider("c", 3),
    ];
    const key = `rr-test-${Date.now()}`; // unique key to avoid counter pollution
    const results = [
      roundRobin(providers, key)?.config.id,
      roundRobin(providers, key)?.config.id,
      roundRobin(providers, key)?.config.id,
    ];
    expect(results).toContain("a");
    expect(results).toContain("b");
    expect(results).toContain("c");
  });
});

// ── Least-busy strategy ────────────────────────────────────────────────────────

describe("leastBusy", () => {
  it("returns null for empty list", () => {
    expect(leastBusy([])).toBeNull();
  });

  it("returns any provider when all have 0 in-flight", () => {
    const providers = [makeProvider("a", 1), makeProvider("b", 2)];
    const result = leastBusy(providers);
    expect(result).not.toBeNull();
  });
});
