/**
 * Sliding-window rate limit tracker.
 * Tracks RPM, RPD, TPM, TPD per provider.
 * Checks limits before a request and records usage after.
 */

import type { ProviderConfig, RateLimitState } from "../types/provider.js";
import { getRateLimitStore } from "./store.js";

const ONE_MINUTE_MS = 60_000;
const ONE_DAY_MS = 86_400_000;
const COOLDOWN_MS = 60_000;        // 1-minute cooldown after rate-limit error
const MAX_CONSECUTIVE_ERRORS = 5;

function emptyState(cfg: ProviderConfig): RateLimitState {
  const now = Date.now();
  return {
    rpm: cfg.limits.rpm ?? 0,
    rpd: cfg.limits.rpd ?? 0,
    tpm: cfg.limits.tpm ?? 0,
    tpd: cfg.limits.tpd ?? 0,
    requestsThisMinute: 0,
    requestsToday: 0,
    tokensThisMinute: 0,
    tokensToday: 0,
    minuteWindowStart: now,
    dayWindowStart: now,
  };
}

function rollWindows(state: RateLimitState): RateLimitState {
  const now = Date.now();
  const s = { ...state };
  if (now - s.minuteWindowStart >= ONE_MINUTE_MS) {
    s.requestsThisMinute = 0;
    s.tokensThisMinute = 0;
    s.minuteWindowStart = now;
  }
  if (now - s.dayWindowStart >= ONE_DAY_MS) {
    s.requestsToday = 0;
    s.tokensToday = 0;
    s.dayWindowStart = now;
  }
  return s;
}

export interface CanSendResult {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
}

export class RateLimitTracker {
  private readonly cfg: ProviderConfig;

  constructor(cfg: ProviderConfig) {
    this.cfg = cfg;
  }

  private async loadState(): Promise<RateLimitState> {
    const store = await getRateLimitStore();
    const stored = await store.get(this.cfg.id);
    const state = stored ?? emptyState(this.cfg);
    return rollWindows(state);
  }

  private async saveState(state: RateLimitState): Promise<void> {
    const store = await getRateLimitStore();
    await store.set(this.cfg.id, state);
  }

  /** Check if a request can be sent (pre-flight check). */
  async canSend(estimatedTokens = 0): Promise<CanSendResult> {
    const state = await this.loadState();
    const now = Date.now();

    // Cooldown check
    if (state.cooledUntil && now < state.cooledUntil) {
      return {
        allowed: false,
        reason: "provider_cooldown",
        retryAfterMs: state.cooledUntil - now,
      };
    }

    // RPM check
    if (state.rpm > 0 && state.requestsThisMinute >= state.rpm) {
      const retryAfterMs = ONE_MINUTE_MS - (now - state.minuteWindowStart);
      return { allowed: false, reason: "rpm_exceeded", retryAfterMs };
    }

    // RPD check
    if (state.rpd > 0 && state.requestsToday >= state.rpd) {
      const retryAfterMs = ONE_DAY_MS - (now - state.dayWindowStart);
      return { allowed: false, reason: "rpd_exceeded", retryAfterMs };
    }

    // TPM check
    if (state.tpm > 0 && estimatedTokens > 0) {
      if (state.tokensThisMinute + estimatedTokens > state.tpm) {
        const retryAfterMs = ONE_MINUTE_MS - (now - state.minuteWindowStart);
        return { allowed: false, reason: "tpm_exceeded", retryAfterMs };
      }
    }

    // TPD check
    if (state.tpd > 0 && estimatedTokens > 0) {
      if (state.tokensToday + estimatedTokens > state.tpd) {
        const retryAfterMs = ONE_DAY_MS - (now - state.dayWindowStart);
        return { allowed: false, reason: "tpd_exceeded", retryAfterMs };
      }
    }

    // Minimum request interval (e.g. Pollinations: 1 req / 15s)
    if (this.cfg.limits.reqIntervalMs && this.cfg.limits.reqIntervalMs > 0) {
      const elapsed = now - state.minuteWindowStart;
      if (elapsed < this.cfg.limits.reqIntervalMs && state.requestsThisMinute > 0) {
        return {
          allowed: false,
          reason: "req_interval",
          retryAfterMs: this.cfg.limits.reqIntervalMs - elapsed,
        };
      }
    }

    return { allowed: true };
  }

  /** Record a successful request + token usage. Call immediately after a successful response. */
  async recordSuccess(tokensUsed: number): Promise<void> {
    const state = await this.loadState();
    state.requestsThisMinute += 1;
    state.requestsToday += 1;
    state.tokensThisMinute += tokensUsed;
    state.tokensToday += tokensUsed;
    // Reset error count on success
    await this.saveState(state);
  }

  /** Record a rate-limit (429) error — applies a brief cooldown. */
  async recordRateLimitError(): Promise<void> {
    const state = await this.loadState();
    // Force the request counters to their limits so the next canSend check fails
    if (state.rpm > 0) state.requestsThisMinute = state.rpm;
    state.cooledUntil = Date.now() + COOLDOWN_MS;
    await this.saveState(state);
  }

  /** Record a non-rate-limit error. After MAX_CONSECUTIVE_ERRORS, apply cooldown. */
  async recordError(consecutiveErrors: number): Promise<void> {
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      const state = await this.loadState();
      state.cooledUntil = Date.now() + COOLDOWN_MS * consecutiveErrors;
      await this.saveState(state);
    }
  }

  /** Apply updates from provider response headers (x-ratelimit-*). */
  async applyHeaderUpdates(updates: {
    remainingRequests?: number;
    remainingTokens?: number;
    resetRequests?: number;
    resetTokens?: number;
  }): Promise<void> {
    const state = await this.loadState();
    if (updates.remainingRequests !== undefined) state.remainingRequests = updates.remainingRequests;
    if (updates.remainingTokens !== undefined) state.remainingTokens = updates.remainingTokens;
    if (updates.resetRequests !== undefined) state.resetRequests = updates.resetRequests;
    if (updates.resetTokens !== undefined) state.resetTokens = updates.resetTokens;
    await this.saveState(state);
  }

  /** Read current state (for health endpoint). */
  async getState(): Promise<RateLimitState> {
    return this.loadState();
  }
}
