/**
 * GET /health — gateway health check
 * GET /health/providers — per-provider health with rate limit state
 */

import type { Context } from "hono";
import { registry } from "../providers/registry.js";
import { getRateLimitStore } from "../ratelimit/store.js";

export function healthHandler(c: Context): Response {
  const providers = registry.getAll();
  const healthy = providers.filter((p) => p.health.status === "healthy").length;
  const total = providers.length;

  const status = total === 0 ? "no_providers" : healthy === total ? "ok" : healthy > 0 ? "degraded" : "unhealthy";

  return c.json({
    status,
    version: "1.0.0",
    service: "llmux",
    timestamp: new Date().toISOString(),
    providers: {
      total,
      healthy,
      degraded: providers.filter((p) => p.health.status === "degraded").length,
      unavailable: providers.filter((p) => p.health.status === "unavailable").length,
      unknown: providers.filter((p) => p.health.status === "unknown").length,
    },
  });
}

export async function providersHealthHandler(c: Context): Promise<Response> {
  const providers = registry.getAll();
  const store = await getRateLimitStore();

  const providerDetails = await Promise.all(
    providers.map(async (provider) => {
      const rlState = await store.get(provider.config.id);
      return {
        id: provider.config.id,
        name: provider.config.name,
        modality: provider.config.modality,
        tier: provider.config.tier,
        status: provider.health.status,
        latency_ms: provider.health.latencyMs,
        last_checked: provider.health.lastChecked
          ? new Date(provider.health.lastChecked).toISOString()
          : null,
        last_error: provider.health.lastError ?? null,
        consecutive_errors: provider.health.consecutiveErrors,
        models: provider.config.models.map((m) => ({
          id: m.id,
          alias: m.alias,
          context_window: m.contextWindow,
        })),
        rate_limits: {
          rpm: provider.config.limits.rpm ?? 0,
          rpd: provider.config.limits.rpd ?? 0,
          tpm: provider.config.limits.tpm ?? 0,
          tpd: provider.config.limits.tpd ?? 0,
        },
        rate_limit_state: rlState
          ? {
              requests_this_minute: rlState.requestsThisMinute,
              requests_today: rlState.requestsToday,
              tokens_this_minute: rlState.tokensThisMinute,
              tokens_today: rlState.tokensToday,
              cooled_until: rlState.cooledUntil
                ? new Date(rlState.cooledUntil).toISOString()
                : null,
              remaining_requests: rlState.remainingRequests,
              remaining_tokens: rlState.remainingTokens,
            }
          : null,
      };
    })
  );

  return c.json({
    timestamp: new Date().toISOString(),
    providers: providerDetails,
  });
}
