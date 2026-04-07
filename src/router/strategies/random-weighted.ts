/**
 * Random-weighted routing strategy.
 * Providers are weighted by tier (tier 1 gets 4× weight vs tier 4).
 * Recommended for production to spread load and avoid hot-spotting.
 */

import type { IProvider } from "../../types/provider.js";

const TIER_WEIGHTS: Record<number, number> = {
  1: 40,
  2: 30,
  3: 20,
  4: 10,
};

export function randomWeighted(providers: IProvider[]): IProvider | null {
  if (providers.length === 0) return null;
  if (providers.length === 1) return providers[0] ?? null;

  const weights = providers.map((p) => TIER_WEIGHTS[p.config.tier] ?? 10);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  let random = Math.random() * totalWeight;

  for (let i = 0; i < providers.length; i++) {
    random -= weights[i] ?? 0;
    if (random <= 0) {
      return providers[i] ?? null;
    }
  }

  return providers[providers.length - 1] ?? null;
}
