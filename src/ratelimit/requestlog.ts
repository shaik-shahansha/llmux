/**
 * In-memory circular buffer for recent request events.
 * Powers the live dashboard feed and stats API.
 * Holds the last MAX_ENTRIES requests in memory — no persistence required.
 */

export type RequestStatus = "success" | "error" | "rate_limited" | "fallback";

export interface RequestLogEntry {
  id: string;
  ts: number;              // unix ms
  modality: string;
  model: string;
  provider: string;        // provider that served the request
  status: RequestStatus;
  latencyMs: number;
  tokensUsed: number;
  costUsd?: number;        // estimated cost in USD (if provider has pricing config)
  fallbackFrom: string[];  // providers tried before the successful one
  error?: string | undefined;
}

const MAX_ENTRIES = 500;

class RequestLog {
  private entries: RequestLogEntry[] = [];
  private totalSuccess = 0;
  private totalError = 0;
  private totalRateLimited = 0;
  private totalTokens = 0;
  private totalRequests = 0;
  private totalCostUsd = 0;

  // Per-provider counters { providerId -> { success, error, tokens, totalLatencyMs, count } }
  private providerStats: Map<string, {
    success: number;
    error: number;
    rateLimited: number;
    tokens: number;
    totalLatencyMs: number;
    count: number;
  }> = new Map();

  record(entry: RequestLogEntry): void {
    // Circular buffer: drop oldest when full
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }

    this.totalRequests++;
    this.totalTokens += entry.tokensUsed;
    if (entry.costUsd) this.totalCostUsd += entry.costUsd;

    if (entry.status === "success" || entry.status === "fallback") {
      this.totalSuccess++;
    } else if (entry.status === "rate_limited") {
      this.totalRateLimited++;
    } else {
      this.totalError++;
    }

    // Per-provider tracking
    const ps = this.providerStats.get(entry.provider) ?? {
      success: 0, error: 0, rateLimited: 0, tokens: 0, totalLatencyMs: 0, count: 0,
    };
    ps.count++;
    ps.tokens += entry.tokensUsed;
    ps.totalLatencyMs += entry.latencyMs;
    if (entry.status === "success" || entry.status === "fallback") ps.success++;
    else if (entry.status === "rate_limited") ps.rateLimited++;
    else ps.error++;
    this.providerStats.set(entry.provider, ps);
  }

  getRecentEntries(limit = 200): RequestLogEntry[] {
    return this.entries.slice(-limit).reverse();
  }

  /**
   * Update the token count for an already-recorded entry.
   * Called by providers after the actual token usage is known
   * (i.e. after parsing the response body or when a stream flushes).
   */
  updateTokens(requestId: string, tokens: number): void {
    if (tokens <= 0) return;
    const entry = this.entries.find((e) => e.id === requestId);
    if (entry) {
      const delta = tokens - entry.tokensUsed;
      entry.tokensUsed = tokens;
      this.totalTokens += delta;
      const ps = this.providerStats.get(entry.provider);
      if (ps) ps.tokens += delta;
    }
  }

  getTotals() {
    return {
      total: this.totalRequests,
      success: this.totalSuccess,
      error: this.totalError,
      rateLimited: this.totalRateLimited,
      tokensTotal: this.totalTokens,
      totalCostUsd: Math.round(this.totalCostUsd * 1000000) / 1000000,
      successRate: this.totalRequests > 0
        ? Math.round((this.totalSuccess / this.totalRequests) * 1000) / 10
        : 100,
    };
  }

  getProviderStats() {
    const result: Array<{
      id: string;
      requests: number;
      success: number;
      error: number;
      rateLimited: number;
      tokens: number;
      avgLatencyMs: number;
    }> = [];
    for (const [id, ps] of this.providerStats.entries()) {
      result.push({
        id,
        requests: ps.count,
        success: ps.success,
        error: ps.error,
        rateLimited: ps.rateLimited,
        tokens: ps.tokens,
        avgLatencyMs: ps.count > 0 ? Math.round(ps.totalLatencyMs / ps.count) : 0,
      });
    }
    return result.sort((a, b) => b.requests - a.requests);
  }
}

// Singleton
export const requestLog = new RequestLog();
