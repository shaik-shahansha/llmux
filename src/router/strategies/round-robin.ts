/**
 * Round-robin routing strategy.
 * Distributes requests evenly across available providers.
 */

import type { IProvider } from "../../types/provider.js";

const counters = new Map<string, number>();

export function roundRobin(providers: IProvider[], groupKey: string): IProvider | null {
  if (providers.length === 0) return null;

  const current = counters.get(groupKey) ?? 0;
  const index = current % providers.length;
  counters.set(groupKey, current + 1);

  return providers[index] ?? null;
}
