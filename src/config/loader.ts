/**
 * Configuration loader.
 * Reads providers.yaml, interpolates ${ENV_VAR} references,
 * validates with Zod, and returns typed config objects.
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import yaml from "js-yaml";
import { ProvidersFileSchema, type ProvidersFile } from "./schema.js";
import type { ProviderConfig } from "../types/provider.js";
import { getDynamicProviders, mergeDynamicProviders } from "./dynamic-config.js";

const ENV_VAR_RE = /\$\{([^}]+)\}/g;

function interpolateEnvVars(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(ENV_VAR_RE, (_, name) => process.env[name] ?? "");
  }
  if (Array.isArray(value)) return value.map(interpolateEnvVars);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, interpolateEnvVars(v)])
    );
  }
  return value;
}

function rawToProviderConfig(raw: ProvidersFile["providers"][number]): ProviderConfig {
  const cfg: ProviderConfig = {
    id: raw.id,
    name: raw.name,
    modality: raw.modality,
    tier: raw.tier,
    enabled: raw.enabled,
    requiresAuth: raw.requires_auth,
    baseUrl: raw.base_url,
    adapter: raw.adapter,
    models: raw.models.map((m) => {
      const model: import("../types/provider.js").ProviderModel = { id: m.id };
      if (m.alias !== undefined) model.alias = m.alias;
      if (m.context_window !== undefined) model.contextWindow = m.context_window;
      if (m.max_output_tokens !== undefined) model.maxOutputTokens = m.max_output_tokens;
      return model;
    }),
    limits: {},
    concurrency: raw.concurrency,
    timeout: raw.timeout,
    maxRetries: raw.max_retries,
  };

  if (raw.api_keys && raw.api_keys.length > 0) {
    const keys = raw.api_keys.filter(Boolean);
    if (keys.length > 0) {
      cfg.apiKeys = keys;
      cfg.apiKey = keys[0] as string; // primary key for backward-compat
    }
  } else if (raw.api_key) {
    cfg.apiKey = raw.api_key;
  }
  if (raw.account_id) cfg.accountId = raw.account_id;
  if (raw.limits.rpm !== undefined) cfg.limits.rpm = raw.limits.rpm;
  if (raw.limits.rpd !== undefined) cfg.limits.rpd = raw.limits.rpd;
  if (raw.limits.tpm !== undefined) cfg.limits.tpm = raw.limits.tpm;
  if (raw.limits.tpd !== undefined) cfg.limits.tpd = raw.limits.tpd;
  if (raw.limits.req_interval_ms !== undefined) cfg.limits.reqIntervalMs = raw.limits.req_interval_ms;
  if (raw.limits.neurons_per_day !== undefined) cfg.limits.neuronsPerDay = raw.limits.neurons_per_day;
  if (raw.limits.chars_per_month !== undefined) cfg.limits.charsPerMonth = raw.limits.chars_per_month;
  if (raw.health_check) cfg.healthCheck = { enabled: raw.health_check.enabled, intervalSeconds: raw.health_check.interval_seconds };
  if (raw.headers) cfg.headers = raw.headers;

  return cfg;
}

export interface LoadedConfig {
  providers: ProviderConfig[];
  router: ProvidersFile["router"];
  gateway: ProvidersFile["gateway"];
}

let _cached: LoadedConfig | null = null;

export function loadConfig(configPath?: string): LoadedConfig {
  if (_cached) return _cached;

  const path = resolve(
    configPath ??
      process.env["PROVIDERS_CONFIG_PATH"] ??
      "config/providers.yaml"
  );

  if (!existsSync(path)) {
    throw new Error(
      `Config file not found: ${path}\n` +
        `Copy providers.yaml.example to ${path} and fill in your API keys.`
    );
  }

  const raw = yaml.load(readFileSync(path, "utf8"));
  const interpolated = interpolateEnvVars(raw);
  const parsed = ProvidersFileSchema.safeParse(interpolated);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid providers.yaml:\n${issues}`);
  }

  const data = parsed.data;
  const baseProviders = data.providers.filter((p) => p.enabled).map(rawToProviderConfig);

  // Merge user-managed dynamic providers (from settings UI) on top of YAML base
  let allProviders: ProviderConfig[];
  try {
    const dynamic = getDynamicProviders().filter((d) => d.enabled);
    allProviders = dynamic.length > 0 ? mergeDynamicProviders(baseProviders, dynamic) : baseProviders;
  } catch {
    allProviders = baseProviders;
  }

  _cached = {
    providers: allProviders,
    router: data.router,
    gateway: data.gateway,
  };

  return _cached;
}

/** Clear the config cache so next loadConfig() re-reads from disk. */
export function invalidateCache(): void {
  _cached = null;
}

/** Clear the config cache (useful for tests). */
export function clearConfigCache(): void {
  _cached = null;
}
