/**
 * LLMux — Entry point
 * Multiplex every LLM. Never hit a limit.
 *
 * Boots the Hono app, registers all routes, and starts the server.
 * Compatible with Node.js, Vercel Edge, Cloudflare Workers, and Bun.
 */

import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";

import { authMiddleware } from "./middleware/auth.js";
import { handleError } from "./middleware/error.js";
import { logger } from "./middleware/logger.js";

import { chatCompletionsHandler } from "./api/chat.js";
import { completionsHandler } from "./api/completions.js";
import { imagesHandler } from "./api/images.js";
import { audioTranscriptionHandler } from "./api/audio-transcribe.js";
import { audioSpeechHandler } from "./api/audio-speech.js";
import { modelsHandler } from "./api/models.js";
import { healthHandler, providersHealthHandler } from "./api/health.js";
import { statsHandler, statsStreamHandler } from "./api/stats.js";

// Admin API
import { setupHandler, loginHandler, logoutHandler, meHandler, changePasswordHandler } from "./api/admin/auth.js";
import { listProviders, getProvider, createProvider, updateProvider, deleteProvider, testProvider, addKey, removeKey } from "./api/admin/providers.js";
import { getSettings, updateSettings, getStatus } from "./api/admin/settings.js";
import { listGatewayKeys, createGatewayKey, deleteGatewayKey } from "./api/admin/gateway-key.js";
import { playgroundChatHandler } from "./api/admin/playground.js";
import { adminAuthMiddleware } from "./middleware/admin-auth.js";
import { isSetupComplete } from "./config/admin-store.js";

import { registry } from "./providers/registry.js";
import { closeStore } from "./ratelimit/store.js";

// ── App setup ─────────────────────────────────────────────────────────────────

const app = new Hono();

// CORS — allow any origin (configure as needed)
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    exposeHeaders: ["X-Provider", "X-Request-Id", "X-RateLimit-Remaining"],
  })
);

// Request logging
app.use("*", async (c, next) => {
  const start = Date.now();
  const requestId =
    c.req.header("X-Request-Id") ??
    Math.random().toString(36).slice(2, 10);

  // requestId stored in header for downstream use


  await next();

  const duration = Date.now() - start;
  logger.info(
    {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration_ms: duration,
      requestId,
    },
    "Request completed"
  );
});

// Auth on all /v1/* routes
app.use("/v1/*", authMiddleware);

// ── Stats & Dashboard APIs (require admin auth for /api/stats in production) ──
app.get("/api/stats", (c, next) => adminAuthMiddleware(c, next), statsHandler);
app.get("/api/stats/stream", (c, next) => adminAuthMiddleware(c, next), statsStreamHandler);

// Setup status (public — needed for redirect logic)
app.get("/api/admin/setup-status", (c) => c.json({ setupComplete: isSetupComplete() }));

// Public admin auth endpoints
app.post("/api/admin/setup", setupHandler);
app.post("/api/admin/login", loginHandler);
app.post("/api/admin/logout", logoutHandler);

// Protected admin endpoints
app.get("/api/admin/me", (c, next) => adminAuthMiddleware(c, next), meHandler);
app.post("/api/admin/change-password", (c, next) => adminAuthMiddleware(c, next), changePasswordHandler);

// Provider management
app.get("/api/admin/providers", (c, next) => adminAuthMiddleware(c, next), listProviders);
app.post("/api/admin/providers", (c, next) => adminAuthMiddleware(c, next), createProvider);
app.get("/api/admin/providers/:id", (c, next) => adminAuthMiddleware(c, next), getProvider);
app.put("/api/admin/providers/:id", (c, next) => adminAuthMiddleware(c, next), updateProvider);
app.delete("/api/admin/providers/:id", (c, next) => adminAuthMiddleware(c, next), deleteProvider);
app.post("/api/admin/providers/:id/test", (c, next) => adminAuthMiddleware(c, next), testProvider);
app.post("/api/admin/providers/:id/keys", (c, next) => adminAuthMiddleware(c, next), addKey);
app.delete("/api/admin/providers/:id/keys/:keyIndex", (c, next) => adminAuthMiddleware(c, next), removeKey);

// Gateway settings
app.get("/api/admin/settings", (c, next) => adminAuthMiddleware(c, next), getSettings);
app.put("/api/admin/settings", (c, next) => adminAuthMiddleware(c, next), updateSettings);
app.get("/api/admin/status", (c, next) => adminAuthMiddleware(c, next), getStatus);

// Gateway API key management
app.get("/api/admin/gateway-key", (c, next) => adminAuthMiddleware(c, next), listGatewayKeys);
app.post("/api/admin/gateway-key", (c, next) => adminAuthMiddleware(c, next), createGatewayKey);
app.delete("/api/admin/gateway-key/:id", (c, next) => adminAuthMiddleware(c, next), deleteGatewayKey);

// ── Health endpoints (no auth) ────────────────────────────────────────────────
app.get("/health", healthHandler);
app.get("/health/providers", providersHealthHandler);

// ── OpenAI-compatible API ─────────────────────────────────────────────────────
app.post("/v1/chat/completions", chatCompletionsHandler);
app.post("/v1/completions", completionsHandler);
app.post("/v1/images/generations", imagesHandler);
app.post("/v1/audio/transcriptions", audioTranscriptionHandler);
app.post("/v1/audio/speech", audioSpeechHandler);
app.get("/v1/models", modelsHandler);

// ── Dashboard static files ────────────────────────────────────────────────────
app.get("/", (c) => {
  return c.redirect("/dashboard");
});

// Helper to serve dashboard HTML files
async function serveHtml(filename: string): Promise<string | null> {
  const { readFileSync } = await import("fs");
  const { resolve } = await import("path");
  try {
    return readFileSync(resolve(`dashboard/${filename}`), "utf8");
  } catch {
    return null;
  }
}

app.get("/setup", async (c) => {
  if (isSetupComplete()) return c.redirect("/login");
  const html = await serveHtml("setup.html");
  return html ? c.html(html) : c.text("Setup page not found", 404);
});

app.get("/login", async (c) => {
  if (!isSetupComplete()) return c.redirect("/setup");
  const html = await serveHtml("login.html");
  return html ? c.html(html) : c.text("Login page not found", 404);
});

app.get("/dashboard", async (c) => {
  if (!isSetupComplete()) return c.redirect("/setup");
  const html = await serveHtml("index.html");
  return html ? c.html(html) : c.text("Dashboard not found. See /health for API status.", 200);
});

app.get("/settings", async (c) => {
  if (!isSetupComplete()) return c.redirect("/setup");
  const html = await serveHtml("settings.html");
  return html ? c.html(html) : c.text("Settings page not found", 404);
});

app.get("/playground", async (c) => {
  if (!isSetupComplete()) return c.redirect("/setup");
  const html = await serveHtml("playground.html");
  return html ? c.html(html) : c.text("Playground page not found", 404);
});

// Admin-authenticated proxy for playground so GATEWAY_API_KEY is not required
app.post("/api/admin/playground/chat", (c, next) => adminAuthMiddleware(c, next), playgroundChatHandler);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.notFound((c) => {
  return c.json(
    {
      error: {
        message: `Route ${c.req.method} ${c.req.path} not found`,
        type: "invalid_request_error",
        code: "route_not_found",
      },
    },
    404
  );
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.onError(handleError);

// ── Startup ───────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env["PORT"] ?? "3000", 10);

function startup() {
  try {
    logger.info("Initializing LLMux provider registry...");
    registry.initialize();

    const providerCount = registry.getAll().length;
    if (providerCount === 0) {
      logger.warn(
        "No providers loaded. Check your API keys in .env and providers.yaml."
      );
    } else {
      logger.info({ providerCount }, "Providers loaded successfully");
    }
  } catch (err) {
    logger.error({ err }, "Failed to initialize provider registry");
    process.exit(1);
  }
}

// Only start server in Node.js context (not Vercel/CF edge)
if (process.env["VERCEL"] !== "1" && process.env["CF_PAGES"] !== "1") {
  startup();

  serve(
    { fetch: app.fetch, port: PORT },
    (info) => {
      logger.info(
        {
          port: info.port,
          url: `http://localhost:${info.port}`,
          dashboard: `http://localhost:${info.port}/dashboard`,
          stats: `http://localhost:${info.port}/api/stats`,
          health: `http://localhost:${info.port}/health`,
        },
        "LLMux gateway started"
      );
    }
  );

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    logger.info("SIGTERM received, shutting down...");
    registry.shutdown();
    await closeStore();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    logger.info("SIGINT received, shutting down...");
    registry.shutdown();
    await closeStore();
    process.exit(0);
  });
}

export default app;
export { app };
