/**
 * Priority routing strategy.
 * Selects the highest-tier available provider.
 * Tier 1 = highest priority, Tier 4 = lowest.
 */

import type { IProvider } from "../../types/provider.js";

export function byPriority(providers: IProvider[]): IProvider | null {
  if (providers.length === 0) return null;

  // Sort by tier ascending (1 = best), then by latency ascending
  const sorted = [...providers].sort((a, b) => {
    const tierDiff = a.config.tier - b.config.tier;
    if (tierDiff !== 0) return tierDiff;
    // Tie-break: prefer lower latency
    const latA = a.health.latencyMs ?? Infinity;
    const latB = b.health.latencyMs ?? Infinity;
    return latA - latB;
  });

  return sorted[0] ?? null;
}
