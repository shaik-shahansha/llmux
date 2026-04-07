/**
 * Least-busy routing strategy.
 * Routes to the provider with the fewest in-flight requests.
 */

import type { IProvider } from "../../types/provider.js";

// Track in-flight request counts per provider
const inFlight = new Map<string, number>();

export function leastBusy(providers: IProvider[]): IProvider | null {
  if (providers.length === 0) return null;

  let best: IProvider | null = null;
  let bestCount = Infinity;

  for (const provider of providers) {
    const count = inFlight.get(provider.config.id) ?? 0;
    if (count < bestCount) {
      bestCount = count;
      best = provider;
    }
  }

  return best;
}

export function incrementInFlight(providerId: string): void {
  inFlight.set(providerId, (inFlight.get(providerId) ?? 0) + 1);
}

export function decrementInFlight(providerId: string): void {
  const current = inFlight.get(providerId) ?? 0;
  inFlight.set(providerId, Math.max(0, current - 1));
}

export function getInFlight(providerId: string): number {
  return inFlight.get(providerId) ?? 0;
}
