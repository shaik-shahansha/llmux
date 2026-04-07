/**
 * Latency-based routing strategy.
 * Routes to the historically fastest provider.
 * Falls back to priority order for unknown latencies.
 */

import type { IProvider } from "../../types/provider.js";

export function latencyBased(providers: IProvider[]): IProvider | null {
  if (providers.length === 0) return null;

  const withLatency = providers.filter((p) => p.health.latencyMs !== undefined);
  const withoutLatency = providers.filter((p) => p.health.latencyMs === undefined);

  if (withLatency.length === 0) {
    // No measurements yet — fall back to first available
    return providers[0] ?? null;
  }

  // Pick fastest among measured providers
  const fastest = withLatency.reduce((best, current) =>
    (current.health.latencyMs ?? Infinity) < (best.health.latencyMs ?? Infinity)
      ? current
      : best
  );

  return fastest;
}
