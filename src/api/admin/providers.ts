/**
 * Provider management API — protected by admin JWT.
 * GET    /api/admin/providers          — list all providers (YAML + dynamic, keys masked)
 * GET    /api/admin/providers/:id      — get single provider
 * POST   /api/admin/providers          — create new dynamic provider
 * PUT    /api/admin/providers/:id      — update existing provider
 * DELETE /api/admin/providers/:id      — remove a dynamic provider
 * POST   /api/admin/providers/:id/test — ping provider health
 * GET    /api/admin/providers/:id/keys — list masked keys
 * POST   /api/admin/providers/:id/keys — add a key
 * DELETE /api/admin/providers/:id/keys/:keyIndex — remove a key by index
 */

import type { Context } from "hono";
import { loadConfig, invalidateCache } from "../../config/loader.js";
import { registry } from "../../providers/registry.js";
import {
  getDynamicProviders,
  saveDynamicProvider,
  deleteDynamicProvider,
  maskKeys,
  maskApiKey,
  type DynamicProviderEntry,
} from "../../config/dynamic-config.js";
import { logger } from "../../middleware/logger.js";

// Seed a dynamic entry from a base YAML-loaded provider for UI editing
function seedFromYaml(p: import("../../types/provider.js").ProviderConfig): DynamicProviderEntry {
  const entry: DynamicProviderEntry = {
    id: p.id,
    name: p.name,
    modality: p.modality,
    tier: p.tier,
    enabled: p.enabled,
    requiresAuth: p.requiresAuth,
    baseUrl: p.baseUrl,
    adapter: p.adapter ?? "openai",
    apiKeys: p.apiKeys ?? (p.apiKey ? [p.apiKey] : []),
    models: p.models.map((m) => {
      const out: { id: string; alias?: string; contextWindow?: number; maxOutputTokens?: number } = { id: m.id };
      if (m.alias !== undefined) out.alias = m.alias;
      if (m.contextWindow !== undefined) out.contextWindow = m.contextWindow;
      if (m.maxOutputTokens !== undefined) out.maxOutputTokens = m.maxOutputTokens;
      return out;
    }),
    limits: {
      ...(p.limits.rpm !== undefined ? { rpm: p.limits.rpm } : {}),
      ...(p.limits.rpd !== undefined ? { rpd: p.limits.rpd } : {}),
      ...(p.limits.tpm !== undefined ? { tpm: p.limits.tpm } : {}),
      ...(p.limits.tpd !== undefined ? { tpd: p.limits.tpd } : {}),
    },
    _source: "yaml",
  };
  if (p.accountId !== undefined) entry.accountId = p.accountId;
  if (p.headers !== undefined) entry.headers = p.headers;
  if (p.concurrency !== undefined) entry.concurrency = p.concurrency;
  if (p.timeout !== undefined) entry.timeout = p.timeout;
  if (p.maxRetries !== undefined) entry.maxRetries = p.maxRetries;
  return entry;
}

// ── List all providers ────────────────────────────────────────────────────────

export async function listProviders(c: Context): Promise<Response> {
  const yamlConfig = loadConfig();
  const dynamic = getDynamicProviders();
  const dynamicIds = new Set(dynamic.map((d) => d.id));

  // Start with YAML providers, then overlay with any dynamic overrides
  const result: DynamicProviderEntry[] = [];

  for (const p of yamlConfig.providers) {
    if (dynamicIds.has(p.id)) continue; // covered by dynamic
    result.push(maskKeys(seedFromYaml(p)));
  }
  for (const d of dynamic) {
    result.push(maskKeys(d));
  }

  // Also include YAML-disabled providers so admin can enable them
  try {
    // Re-read raw YAML without enabling filter
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const yaml = await import("js-yaml");
    const { ProvidersFileSchema } = await import("../../config/schema.js");
    const raw = yaml.default.load(readFileSync(resolve("config/providers.yaml"), "utf8"));
    const ENV_VAR_RE = /\$\{([^}]+)\}/g;
    function interpolate(v: unknown): unknown {
      if (typeof v === "string") return v.replace(ENV_VAR_RE, (_, n) => process.env[n as string] ?? "");
      if (Array.isArray(v)) return v.map(interpolate);
      if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, interpolate(val)]));
      return v;
    }
    const parsed = ProvidersFileSchema.safeParse(interpolate(raw));
    if (parsed.success) {
      const allYamlIds = new Set(parsed.data.providers.map((p) => p.id));
      const resultIds = new Set(result.map((r) => r.id));
      for (const p of parsed.data.providers) {
        if (!p.enabled && !resultIds.has(p.id) && !dynamicIds.has(p.id)) {
          // Disabled YAML provider — surface to admin
          const dentry: DynamicProviderEntry = {
            id: p.id, name: p.name, modality: p.modality as DynamicProviderEntry["modality"],
            tier: p.tier as 1 | 2 | 3 | 4, enabled: false, requiresAuth: p.requires_auth,
            baseUrl: p.base_url, adapter: p.adapter as DynamicProviderEntry["adapter"],
            apiKeys: (p.api_keys ?? (p.api_key ? [p.api_key] : [])).map(maskApiKey),
            models: p.models.map((m) => {
              const mout: { id: string; alias?: string } = { id: m.id };
              if (m.alias !== undefined) mout.alias = m.alias;
              return mout;
            }),
            limits: {
              ...(p.limits.rpm !== undefined ? { rpm: p.limits.rpm } : {}),
              ...(p.limits.rpd !== undefined ? { rpd: p.limits.rpd } : {}),
              ...(p.limits.tpm !== undefined ? { tpm: p.limits.tpm } : {}),
              ...(p.limits.tpd !== undefined ? { tpd: p.limits.tpd } : {}),
            },
            _source: "yaml",
          };
          result.push(dentry);
          resultIds.add(p.id);
        }
      }
      void allYamlIds; // suppress unused warning
    }
  } catch { /* non-critical — just surface what we have */ }

  return c.json({ providers: result });
}

// ── Get single provider ───────────────────────────────────────────────────────

export async function getProvider(c: Context): Promise<Response> {
  const id = c.req.param("id")!;
  const dynamic = getDynamicProviders().find((d) => d.id === id);
  if (dynamic) return c.json({ provider: maskKeys(dynamic) });

  const cfg = loadConfig();
  const p = cfg.providers.find((p) => p.id === id);
  if (p) return c.json({ provider: maskKeys(seedFromYaml(p)) });

  return c.json({ error: { message: "Provider not found", code: "not_found" } }, 404);
}

// ── Create provider ───────────────────────────────────────────────────────────

export async function createProvider(c: Context): Promise<Response> {
  let body: Partial<DynamicProviderEntry>;
  try {
    body = await c.req.json() as Partial<DynamicProviderEntry>;
  } catch {
    return c.json({ error: { message: "Invalid JSON", code: "invalid_request" } }, 400);
  }

  if (!body.id || !body.name || !body.modality || !body.baseUrl) {
    return c.json({ error: { message: "id, name, modality, baseUrl are required", code: "invalid_request" } }, 400);
  }

  const existing = getDynamicProviders().find((d) => d.id === body.id);
  if (existing) {
    return c.json({ error: { message: "Provider ID already exists", code: "conflict" } }, 409);
  }

  const id = body.id;
  const name = body.name;
  const modality = body.modality;
  const baseUrl = body.baseUrl;

  const entry: DynamicProviderEntry = {
    id,
    name,
    modality,
    tier: body.tier ?? 2,
    enabled: body.enabled ?? true,
    requiresAuth: body.requiresAuth ?? true,
    baseUrl,
    adapter: body.adapter ?? "openai",
    apiKeys: body.apiKeys ?? [],
    models: body.models ?? [{ id: "default" }],
    limits: body.limits ?? {},
    concurrency: body.concurrency ?? 5,
    timeout: body.timeout ?? 30000,
    maxRetries: body.maxRetries ?? 2,
    _source: "manual",
  };
  if (body.accountId !== undefined) entry.accountId = body.accountId;
  if (body.costPerMToken !== undefined) entry.costPerMToken = body.costPerMToken;
  if (body.headers !== undefined) entry.headers = body.headers;

  saveDynamicProvider(entry);
  invalidateCache(); registry.reinitialize();
  logger.info({ id: entry.id }, "Provider created via settings UI");
  return c.json({ provider: maskKeys(entry) }, 201);
}

// ── Update provider ───────────────────────────────────────────────────────────

export async function updateProvider(c: Context): Promise<Response> {
  const id = c.req.param("id")!;
  let body: Partial<DynamicProviderEntry>;
  try {
    body = await c.req.json() as Partial<DynamicProviderEntry>;
  } catch {
    return c.json({ error: { message: "Invalid JSON", code: "invalid_request" } }, 400);
  }

  // Fetch existing entry (from dynamic or seed from YAML)
  let current = getDynamicProviders().find((d) => d.id === id);
  if (!current) {
    const cfg = loadConfig();
    const p = cfg.providers.find((p) => p.id === id);
    if (!p) return c.json({ error: { message: "Provider not found", code: "not_found" } }, 404);
    current = seedFromYaml(p);
    current._source = "yaml";
  }

  // If the incoming apiKeys contain masked values, preserve originals
  const currentKeys = getDynamicProviders().find((d) => d.id === id)?.apiKeys ?? current.apiKeys;
  const incomingKeys = body.apiKeys ?? currentKeys;
  const finalKeys = incomingKeys.map((k, i) => {
    if (k.includes("...")) {
      // Masked value — keep original
      return currentKeys[i] ?? k;  // preserve original if masked
    }
    return k;
  });

  const updated: DynamicProviderEntry = {
    ...current,
    ...body,
    id, // never change id
    apiKeys: finalKeys,
    _source: (current._source ?? "manual") as "yaml" | "manual",
  };

  saveDynamicProvider(updated);
  invalidateCache(); registry.reinitialize();
  logger.info({ id }, "Provider updated via settings UI");
  return c.json({ provider: maskKeys(updated) });
}

// ── Delete provider ───────────────────────────────────────────────────────────

export async function deleteProvider(c: Context): Promise<Response> {
  const id = c.req.param("id")!;
  const deleted = deleteDynamicProvider(id);
  if (!deleted) {
    return c.json({ error: { message: "Provider not found in dynamic config", code: "not_found" } }, 404);
  }
  invalidateCache(); registry.reinitialize();
  logger.info({ id }, "Provider deleted via settings UI");
  return c.json({ success: true });
}

// ── Test provider connectivity ────────────────────────────────────────────────

export async function testProvider(c: Context): Promise<Response> {
  const id = c.req.param("id")!;
  const provider = registry.getById(id);
  if (!provider) {
    return c.json({ error: { message: "Provider not loaded (may need restart)", code: "not_found" } }, 404);
  }
  try {
    const ok = await provider.ping();
    return c.json({ id, healthy: ok });
  } catch (err) {
    return c.json({ id, healthy: false, error: String(err) });
  }
}

// ── Key management ────────────────────────────────────────────────────────────

export async function addKey(c: Context): Promise<Response> {
  const id = c.req.param("id")!;
  let body: { key?: string };
  try {
    body = await c.req.json() as { key?: string };
  } catch {
    return c.json({ error: { message: "Invalid JSON", code: "invalid_request" } }, 400);
  }
  if (!body.key || body.key.length < 4) {
    return c.json({ error: { message: "key is required", code: "invalid_request" } }, 400);
  }
  const newKey = body.key;

  let entry = getDynamicProviders().find((d) => d.id === id);
  if (!entry) {
    const cfg = loadConfig();
    const p = cfg.providers.find((p) => p.id === id);
    if (!p) return c.json({ error: { message: "Provider not found", code: "not_found" } }, 404);
    entry = seedFromYaml(p);
  }

  if (!entry.apiKeys.includes(newKey)) {
    entry.apiKeys.push(newKey);
    saveDynamicProvider(entry);
    invalidateCache(); registry.reinitialize();
  }

  return c.json({ keys: entry.apiKeys.map(maskApiKey) });
}

export async function removeKey(c: Context): Promise<Response> {
  const id = c.req.param("id")!;
  const keyIndex = Number(c.req.param("keyIndex") ?? "0");

  const entry = getDynamicProviders().find((d) => d.id === id);
  if (!entry) return c.json({ error: { message: "Provider not found", code: "not_found" } }, 404);
  if (isNaN(keyIndex) || keyIndex < 0 || keyIndex >= entry.apiKeys.length) {
    return c.json({ error: { message: "Invalid key index", code: "invalid_request" } }, 400);
  }

  entry.apiKeys.splice(keyIndex, 1);
  saveDynamicProvider(entry);
  invalidateCache(); registry.reinitialize();

  return c.json({ keys: entry.apiKeys.map(maskApiKey) });
}
