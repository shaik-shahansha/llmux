/**
 * Dynamic provider configuration store.
 * Persists user-managed provider configs to config/providers-dynamic.json.
 * These override/extend the base providers.yaml on load.
 * 
 * API keys are stored in plaintext in the JSON file;  security is achieved
 * through file permissions (0600) + admin auth on all write endpoints.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import type { ProviderConfig, Modality } from "../types/provider.js";

const DYNAMIC_CONFIG_PATH = resolve("config/providers-dynamic.json");

export interface DynamicProviderEntry {
  id: string;
  name: string;
  modality: Modality;
  tier: 1 | 2 | 3 | 4;
  enabled: boolean;
  requiresAuth: boolean;
  baseUrl: string;
  adapter: "openai" | "gemini" | "cloudflare" | "cohere" | "custom";
  apiKeys: string[];          // raw keys — stored in file, masked in API responses
  accountId?: string;
  models: Array<{ id: string; alias?: string; contextWindow?: number; maxOutputTokens?: number }>;
  limits: {
    rpm?: number; rpd?: number;
    tpm?: number; tpd?: number;
  };
  costPerMToken?: { input: number; output: number };  // USD per million tokens
  headers?: Record<string, string>;
  concurrency?: number;
  timeout?: number;
  maxRetries?: number;
  // Source: "yaml" entries are seeded from providers.yaml, "manual" are user-created
  _source?: "yaml" | "manual";
}

interface DynamicConfigFile {
  version: 1;
  providers: DynamicProviderEntry[];
}

// ── Persistence ───────────────────────────────────────────────────────────────

function ensureConfigDir(): void {
  const dir = resolve("config");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function readDynamicConfig(): DynamicConfigFile {
  if (!existsSync(DYNAMIC_CONFIG_PATH)) {
    return { version: 1, providers: [] };
  }
  try {
    return JSON.parse(readFileSync(DYNAMIC_CONFIG_PATH, "utf8")) as DynamicConfigFile;
  } catch {
    return { version: 1, providers: [] };
  }
}

export function writeDynamicConfig(cfg: DynamicConfigFile): void {
  ensureConfigDir();
  writeFileSync(DYNAMIC_CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export function getDynamicProviders(): DynamicProviderEntry[] {
  return readDynamicConfig().providers;
}

export function saveDynamicProvider(entry: DynamicProviderEntry): void {
  const cfg = readDynamicConfig();
  const idx = cfg.providers.findIndex((p) => p.id === entry.id);
  if (idx >= 0) {
    cfg.providers[idx] = entry;
  } else {
    cfg.providers.push(entry);
  }
  writeDynamicConfig(cfg);
}

export function deleteDynamicProvider(id: string): boolean {
  const cfg = readDynamicConfig();
  const before = cfg.providers.length;
  cfg.providers = cfg.providers.filter((p) => p.id !== id);
  if (cfg.providers.length !== before) {
    writeDynamicConfig(cfg);
    return true;
  }
  return false;
}

// ── Merge dynamic providers into base ProviderConfig list ─────────────────────

export function mergeDynamicProviders(
  baseProviders: ProviderConfig[],
  dynamic: DynamicProviderEntry[]
): ProviderConfig[] {
  const result = new Map<string, ProviderConfig>();
  for (const p of baseProviders) result.set(p.id, p);

  for (const d of dynamic) {
    const converted = dynamicToProviderConfig(d);
    result.set(d.id, converted);
  }

  return Array.from(result.values());
}

export function dynamicToProviderConfig(d: DynamicProviderEntry): ProviderConfig {
  const keys = d.apiKeys.filter(Boolean);
  const cfg: ProviderConfig = {
    id: d.id,
    name: d.name,
    modality: d.modality,
    tier: d.tier,
    enabled: d.enabled,
    requiresAuth: d.requiresAuth,
    baseUrl: d.baseUrl,
    adapter: d.adapter,
    models: d.models,
    limits: d.limits,
    concurrency: d.concurrency ?? 5,
    timeout: d.timeout ?? 30000,
    maxRetries: d.maxRetries ?? 2,
  };
  if (keys[0] !== undefined) { cfg.apiKey = keys[0]; }
  if (keys.length > 0) { cfg.apiKeys = keys; }
  if (d.accountId !== undefined) { cfg.accountId = d.accountId; }
  if (d.headers !== undefined) { cfg.headers = d.headers; }
  return cfg;
}

// ── Key masking for safe API responses ────────────────────────────────────────

export function maskApiKey(key: string): string {
  if (!key || key.length < 8) return "***";
  const prefix = key.slice(0, Math.min(7, Math.floor(key.length * 0.3)));
  const suffix = key.slice(-4);
  return `${prefix}...${suffix}`;
}

export function maskKeys(entry: DynamicProviderEntry): DynamicProviderEntry {
  return {
    ...entry,
    apiKeys: entry.apiKeys.map(maskApiKey),
  };
}
