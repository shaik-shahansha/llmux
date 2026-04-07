/**
 * Gateway settings API — protected by admin JWT.
 * GET  /api/admin/settings         — get router + gateway config
 * PUT  /api/admin/settings         — update router strategy / gateway limits
 * GET  /api/admin/settings/status  — runtime status summary
 */

import type { Context } from "hono";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { loadConfig, invalidateCache } from "../../config/loader.js";
import { requestLog } from "../../ratelimit/requestlog.js";
import { registry } from "../../providers/registry.js";
import { logger } from "../../middleware/logger.js";

const GATEWAY_SETTINGS_PATH = resolve("config/gateway-settings.json");

interface GatewaySettings {
  router: {
    default_strategy: "round-robin" | "least-busy" | "priority" | "latency-based" | "random-weighted";
    fallback_enabled: boolean;
    max_fallback_attempts: number;
  };
  gateway: {
    max_request_size_mb: number;
    request_timeout_ms: number;
    enable_request_logging: boolean;
  };
}

function readGatewaySettings(): GatewaySettings | null {
  if (!existsSync(GATEWAY_SETTINGS_PATH)) return null;
  try {
    return JSON.parse(readFileSync(GATEWAY_SETTINGS_PATH, "utf8")) as GatewaySettings;
  } catch {
    return null;
  }
}

function writeGatewaySettings(s: GatewaySettings): void {
  writeFileSync(GATEWAY_SETTINGS_PATH, JSON.stringify(s, null, 2), { mode: 0o600 });
}

export async function getSettings(c: Context): Promise<Response> {
  const cfg = loadConfig();
  const override = readGatewaySettings();
  return c.json({
    router: override?.router ?? cfg.router,
    gateway: override?.gateway ?? cfg.gateway,
  });
}

export async function updateSettings(c: Context): Promise<Response> {
  let body: Partial<GatewaySettings>;
  try {
    body = await c.req.json() as Partial<GatewaySettings>;
  } catch {
    return c.json({ error: { message: "Invalid JSON", code: "invalid_request" } }, 400);
  }

  const cfg = loadConfig();
  const current = readGatewaySettings() ?? {
    router: cfg.router as GatewaySettings["router"],
    gateway: cfg.gateway as GatewaySettings["gateway"],
  };

  const updated: GatewaySettings = {
    router: { ...current.router, ...(body.router ?? {}) },
    gateway: { ...current.gateway, ...(body.gateway ?? {}) },
  };

  writeGatewaySettings(updated);
  invalidateCache();
  registry.reinitialize();
  logger.info({}, "Gateway settings updated via admin UI");
  return c.json(updated);
}

export async function getStatus(c: Context): Promise<Response> {
  const totals = requestLog.getTotals();
  const providerStats = requestLog.getProviderStats();
  const allProviders = registry.getAll();

  const providerHealth = allProviders.map((p) => ({
    id: p.config.id,
    name: p.config.name,
    modality: p.config.modality,
    tier: p.config.tier,
    status: p.health.status,
    latencyMs: p.health.latencyMs,
    lastError: p.health.lastError,
    consecutiveErrors: p.health.consecutiveErrors,
  }));

  return c.json({
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    requests: totals,
    providers: providerHealth,
    providerStats,
  });
}
