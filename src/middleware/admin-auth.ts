/**
 * Admin JWT middleware.
 * Verifies Bearer token from Authorization header or
 * llmux_admin_token cookie (set by login page).
 * Redirects to /login for browser requests, returns 401 for API requests.
 */

import type { Context, Next } from "hono";
import { readAdminConfig, verifyJWT } from "../config/admin-store.js";

function extractToken(c: Context): string | null {
  // 1. Authorization: Bearer <token>
  const auth = c.req.header("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);

  // 2. Cookie: llmux_admin_token=<token>
  const cookie = c.req.header("Cookie") ?? "";
  const match = /llmux_admin_token=([^;]+)/.exec(cookie);
  if (match) return decodeURIComponent(match[1] ?? "");

  return null;
}

export async function adminAuthMiddleware(c: Context, next: Next): Promise<Response | void> {
  const cfg = readAdminConfig();
  if (!cfg?.setupComplete) {
    // Setup not done — redirect browser, return 401 for API
    if (c.req.header("Accept")?.includes("text/html")) {
      return c.redirect("/setup");
    }
    return c.json({ error: { message: "Admin setup not complete", code: "setup_required" } }, 401);
  }

  const token = extractToken(c);
  if (!token) {
    if (c.req.header("Accept")?.includes("text/html") && !c.req.path.startsWith("/api/")) {
      return c.redirect("/login");
    }
    return c.json({ error: { message: "Unauthorized", code: "unauthorized" } }, 401);
  }

  const payload = verifyJWT(token, cfg.jwtSecret);
  if (!payload) {
    if (c.req.header("Accept")?.includes("text/html") && !c.req.path.startsWith("/api/")) {
      return c.redirect("/login");
    }
    return c.json({ error: { message: "Invalid or expired token", code: "unauthorized" } }, 401);
  }

  // Attach username to context
  c.set("adminUser", payload["username"] as string);
  return next();
}
