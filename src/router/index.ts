/**
 * Main router.
 * Selects providers based on strategy and executes with fallback.
 */

import type { IProvider, RequestContext, Modality, RouterStrategy } from "../types/provider.js";
import { registry } from "../providers/registry.js";
import { loadConfig } from "../config/loader.js";
import { withFallback } from "./fallback.js";
import { roundRobin } from "./strategies/round-robin.js";
import { leastBusy, incrementInFlight, decrementInFlight } from "./strategies/least-busy.js";
import { byPriority } from "./strategies/priority.js";
import { latencyBased } from "./strategies/latency-based.js";
import { randomWeighted } from "./strategies/random-weighted.js";
import { logger } from "../middleware/logger.js";

type ProviderCall = (provider: IProvider) => Promise<Response>;

function selectProvider(
  candidates: IProvider[],
  strategy: RouterStrategy,
  groupKey: string
): IProvider | null {
  switch (strategy) {
    case "round-robin":
      return roundRobin(candidates, groupKey);
    case "least-busy":
      return leastBusy(candidates);
    case "priority":
      return byPriority(candidates);
    case "latency-based":
      return latencyBased(candidates);
    case "random-weighted":
      return randomWeighted(candidates);
    default:
      return byPriority(candidates);
  }
}

export async function routeRequest(
  call: ProviderCall,
  ctx: RequestContext
): Promise<Response> {
  const cfg = loadConfig();
  const strategy = cfg.router.default_strategy;

  // Get all providers that match the modality
  let candidates = registry.getByModality(ctx.modality);

  // If a specific model was requested, filter to providers that support it
  // (unless the model is "auto")
  if (ctx.model !== "auto") {
    const modelCandidates = candidates.filter((p) =>
      p.config.models.some((m) => m.id === ctx.model || m.alias === ctx.model)
    );
    if (modelCandidates.length > 0) {
      candidates = modelCandidates;
    }
    // else: no provider explicitly supports this model — use all modality providers
    // and let each provider's resolveModel() do its best
  }

  // Filter to healthy/usable providers
  candidates = candidates.filter(
    (p) => p.health.status !== "unavailable" && p.config.enabled
  );

  if (candidates.length === 0) {
    throw new Error(
      `No providers available for modality="${ctx.modality}" model="${ctx.model}"`
    );
  }

  logger.debug(
    {
      requestId: ctx.requestId,
      modality: ctx.modality,
      model: ctx.model,
      strategy,
      candidateCount: candidates.length,
    },
    "Routing request"
  );

  if (!cfg.router.fallback_enabled) {
    // Single provider, no fallback
    const provider = selectProvider(candidates, strategy, `${ctx.modality}:${ctx.model}`);
    if (!provider) {
      throw new Error(`No provider selected for ${ctx.modality}:${ctx.model}`);
    }
    incrementInFlight(provider.config.id);
    try {
      return await call(provider);
    } finally {
      decrementInFlight(provider.config.id);
    }
  }

  // Fallback mode: try providers in order
  return withFallback(
    candidates,
    async (provider) => {
      incrementInFlight(provider.config.id);
      try {
        return await call(provider);
      } finally {
        decrementInFlight(provider.config.id);
      }
    },
    ctx,
    { maxAttempts: cfg.router.max_fallback_attempts }
  );
}
