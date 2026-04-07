/**
 * 3-level fallback engine.
 *
 * Level 1: Retry the same provider (up to maxRetries) with backoff.
 * Level 2: Switch to another provider with the same model.
 * Level 3: Switch to any available provider for the same modality/tier.
 *
 * Tracks which providers have been tried to avoid loops.
 */

import type { IProvider, RequestContext, Modality } from "../types/provider.js";
import { RateLimitError, ProviderError } from "../providers/base.js";
import { logger } from "../middleware/logger.js";
import { requestLog } from "../ratelimit/requestlog.js";

type ProviderCall<T> = (provider: IProvider) => Promise<T>;

export interface FallbackOptions {
  maxAttempts?: number;
  initialBackoffMs?: number;
}

export async function withFallback<T>(
  candidates: IProvider[],
  call: ProviderCall<T>,
  ctx: RequestContext,
  opts: FallbackOptions = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const initialBackoffMs = opts.initialBackoffMs ?? 500;

  const tried = new Set<string>();
  const errors: Array<{ provider: string; error: string }> = [];

  // Sort candidates: tier 1 first, then by latency
  const sorted = [...candidates].sort((a, b) => {
    const tierDiff = a.config.tier - b.config.tier;
    if (tierDiff !== 0) return tierDiff;
    return (a.health.latencyMs ?? 9999) - (b.health.latencyMs ?? 9999);
  });

  for (let attempt = 0; attempt < maxAttempts && attempt < sorted.length; attempt++) {
    // Find next untried provider
    const provider = sorted.find((p) => !tried.has(p.config.id));
    if (!provider) break;

    tried.add(provider.config.id);

    // Pre-flight rate limit check
    const canSend = await (provider.rateLimitTracker as import("../ratelimit/tracker.js").RateLimitTracker).canSend(ctx.estimatedTokens);
    if (!canSend.allowed) {
      logger.debug(
        { provider: provider.config.id, reason: canSend.reason },
        "Skipping provider (rate limited)"
      );
      errors.push({ provider: provider.config.id, error: `rate_limited: ${canSend.reason}` });
      continue;
    }

    try {
      logger.debug(
        { provider: provider.config.id, attempt, requestId: ctx.requestId },
        "Attempting provider"
      );

      const start = Date.now();
      const result = await call(provider);
      const latencyMs = Date.now() - start;

      logger.info(
        { provider: provider.config.id, attempt, requestId: ctx.requestId },
        "Provider succeeded"
      );

      requestLog.record({
        id: ctx.requestId,
        ts: Date.now(),
        modality: ctx.modality,
        model: ctx.model,
        provider: provider.config.id,
        status: errors.length > 0 ? "fallback" : "success",
        latencyMs,
        tokensUsed: ctx.resolvedTokens ?? 0, // set by recordTokens() for non-streaming
        fallbackFrom: errors.map((e) => e.provider),
      });

      return result;
    } catch (err) {
      const errorMsg = (err as Error).message;
      errors.push({ provider: provider.config.id, error: errorMsg });

      const isRateLimit = err instanceof RateLimitError;
      const isTemporary = isRateLimit ||
        (err instanceof ProviderError && (err.statusCode === 503 || err.statusCode === 502));

      logger.warn(
        { provider: provider.config.id, attempt, error: errorMsg, isRateLimit },
        "Provider failed, trying fallback"
      );

      // Level 1: Same provider retry with backoff (only for transient errors)
      if (!isRateLimit && attempt === 0 && provider.config.maxRetries && provider.config.maxRetries > 0) {
        for (let retry = 0; retry < provider.config.maxRetries; retry++) {
          const backoff = initialBackoffMs * 2 ** retry;
          await sleep(backoff);
          try {
            const result = await call(provider);
            return result;
          } catch {
            // Continue to next provider
          }
        }
      }
    }
  }

  const errorSummary = errors.map((e) => `  - ${e.provider}: ${e.error}`).join("\n");

  requestLog.record({
    id: ctx.requestId,
    ts: Date.now(),
    modality: ctx.modality,
    model: ctx.model,
    provider: errors.length > 0 ? (errors[errors.length - 1]?.provider ?? "unknown") : "unknown",
    status: "error",
    latencyMs: 0,
    tokensUsed: 0,
    fallbackFrom: errors.slice(0, -1).map((e) => e.provider),
    error: errors[errors.length - 1]?.error,
  });

  throw new Error(
    `All providers failed for request ${ctx.requestId}:\n` + errorSummary
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
