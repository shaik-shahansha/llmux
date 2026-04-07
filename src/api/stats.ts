/**
 * GET /api/stats       — snapshot of all stats + recent request log
 * GET /api/stats/stream — SSE stream of request events (live dashboard feed)
 */

import type { Context } from "hono";
import { registry } from "../providers/registry.js";
import { getRateLimitStore } from "../ratelimit/store.js";
import { requestLog } from "../ratelimit/requestlog.js";

export async function statsHandler(c: Context): Promise<Response> {
  const providers = registry.getAll();
  const store = await getRateLimitStore();

  const providerDetails = await Promise.all(
    providers.map(async (p) => {
      const rl = await store.get(p.config.id);
      const ps = requestLog.getProviderStats().find((s) => s.id === p.config.id);
      return {
        id: p.config.id,
        name: p.config.name,
        modality: p.config.modality,
        tier: p.config.tier,
        status: p.health.status,
        latencyMs: p.health.latencyMs ?? null,
        consecutiveErrors: p.health.consecutiveErrors,
        lastError: p.health.lastError ?? null,
        models: p.config.models.map((m) => m.alias ?? m.id),
        limits: {
          rpm: p.config.limits.rpm ?? 0,
          rpd: p.config.limits.rpd ?? 0,
          tpm: p.config.limits.tpm ?? 0,
          tpd: p.config.limits.tpd ?? 0,
        },
        usage: rl
          ? {
              requestsThisMinute: rl.requestsThisMinute,
              requestsToday: rl.requestsToday,
              tokensThisMinute: rl.tokensThisMinute,
              tokensToday: rl.tokensToday,
              rpmPct: p.config.limits.rpm
                ? Math.round((rl.requestsThisMinute / p.config.limits.rpm) * 100)
                : 0,
              rpdPct: p.config.limits.rpd
                ? Math.round((rl.requestsToday / p.config.limits.rpd) * 100)
                : 0,
              cooledUntil: rl.cooledUntil ?? null,
            }
          : null,
        stats: ps ?? null,
        apiKeyCount: p.config.apiKeys?.length ?? (p.config.apiKey ? 1 : 0),
      };
    })
  );

  return c.json({
    ts: Date.now(),
    gateway: {
      name: "LLMux",
      version: "1.0.0",
      uptime: Math.round(process.uptime()),
      providerCount: providers.length,
      healthyCount: providers.filter((p) => p.health.status === "healthy").length,
    },
    totals: requestLog.getTotals(),
    providers: providerDetails,
    recent: requestLog.getRecentEntries(200),
    byProvider: requestLog.getProviderStats(),
  });
}

// SSE live feed — pushes a new event every time a request completes
export function statsStreamHandler(c: Context): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  let closed = false;

  // Send a heartbeat every 5s to keep the connection alive
  const heartbeat = setInterval(async () => {
    if (closed) return clearInterval(heartbeat);
    try {
      // Send current stats snapshot
      const providers = registry.getAll();
      const recent = requestLog.getRecentEntries(1);
      const payload = JSON.stringify({
        type: "heartbeat",
        ts: Date.now(),
        recent,
        totals: requestLog.getTotals(),
        providerStatuses: providers.map((p) => ({
          id: p.config.id,
          status: p.health.status,
          latencyMs: p.health.latencyMs ?? null,
        })),
      });
      await writer.write(encoder.encode(`data: ${payload}\n\n`));
    } catch {
      closed = true;
      clearInterval(heartbeat);
    }
  }, 3000);

  // Clean up when client disconnects
  c.req.raw.signal?.addEventListener("abort", () => {
    closed = true;
    clearInterval(heartbeat);
    writer.close().catch(() => {});
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
