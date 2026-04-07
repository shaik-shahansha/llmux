/**
 * Admin authentication API endpoints.
 * POST /api/admin/setup  — first-time admin account creation
 * POST /api/admin/login  — returns JWT token
 * POST /api/admin/logout — clears cookie (client-side)
 * GET  /api/admin/me     — returns current admin username
 */

import type { Context } from "hono";
import {
  isSetupComplete,
  createAdmin,
  readAdminConfig,
  writeAdminConfig,
  verifyPassword,
  hashPassword,
  signJWT,
} from "../../config/admin-store.js";
import { logger } from "../../middleware/logger.js";

// ── Rate limiting (simple in-memory) for login endpoint ──────────────────────
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function checkLoginRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt < now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count++;
  return true;
}

// ── Handlers ─────────────────────────────────────────────────────────────────

export async function setupHandler(c: Context): Promise<Response> {
  if (isSetupComplete()) {
    return c.json({ error: { message: "Setup already complete", code: "already_setup" } }, 409);
  }

  let body: { username?: string; password?: string };
  try {
    body = await c.req.json() as { username?: string; password?: string };
  } catch {
    return c.json({ error: { message: "Invalid JSON body", code: "invalid_request" } }, 400);
  }

  const { username, password } = body;
  if (!username || !password) {
    return c.json({ error: { message: "username and password are required", code: "invalid_request" } }, 400);
  }

  try {
    createAdmin(username, password);
    logger.info({ username }, "Admin account created");
    return c.json({ success: true, message: "Admin account created. Please log in." });
  } catch (err) {
    return c.json({ error: { message: (err as Error).message, code: "invalid_request" } }, 400);
  }
}

export async function loginHandler(c: Context): Promise<Response> {
  if (!isSetupComplete()) {
    return c.json({ error: { message: "Setup not complete", code: "setup_required" } }, 403);
  }

  // Rate limit by IP
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkLoginRateLimit(ip)) {
    return c.json({ error: { message: "Too many login attempts. Try again in 15 minutes.", code: "rate_limited" } }, 429);
  }

  let body: { username?: string; password?: string };
  try {
    body = await c.req.json() as { username?: string; password?: string };
  } catch {
    return c.json({ error: { message: "Invalid JSON body", code: "invalid_request" } }, 400);
  }

  const { username, password } = body;
  if (!username || !password) {
    return c.json({ error: { message: "username and password are required", code: "invalid_request" } }, 400);
  }

  const cfg = readAdminConfig()!;

  // Verify credentials (constant-time comparison prevents timing attacks)
  const validUser = cfg.username === username;
  const validPass = verifyPassword(password, cfg.passwordHash, cfg.passwordSalt);

  if (!validUser || !validPass) {
    logger.warn({ username, ip }, "Failed admin login attempt");
    // Always return same message to prevent user enumeration
    return c.json({ error: { message: "Invalid username or password", code: "unauthorized" } }, 401);
  }

  const token = signJWT({ username, role: "admin" }, cfg.jwtSecret);
  logger.info({ username }, "Admin logged in");

  // Set as HttpOnly cookie (8h) + return in body for API clients
  const cookieValue = `llmux_admin_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${8 * 3600}`;

  return new Response(
    JSON.stringify({ success: true, token }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": cookieValue,
      },
    }
  );
}

export async function logoutHandler(c: Context): Promise<Response> {
  const clearCookie = "llmux_admin_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0";
  return new Response(
    JSON.stringify({ success: true }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": clearCookie,
      },
    }
  );
}

export async function meHandler(c: Context): Promise<Response> {
  const username = c.get("adminUser") as string;
  return c.json({ username, role: "admin" });
}

export async function changePasswordHandler(c: Context): Promise<Response> {
  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await c.req.json() as { currentPassword?: string; newPassword?: string };
  } catch {
    return c.json({ error: { message: "Invalid JSON body", code: "invalid_request" } }, 400);
  }
  const { currentPassword, newPassword } = body;
  if (!currentPassword || !newPassword) {
    return c.json({ error: { message: "currentPassword and newPassword are required", code: "invalid_request" } }, 400);
  }
  if (newPassword.length < 8) {
    return c.json({ error: { message: "Password must be at least 8 characters", code: "invalid_request" } }, 400);
  }

  const cfg = readAdminConfig()!;
  if (!verifyPassword(currentPassword, cfg.passwordHash, cfg.passwordSalt)) {
    return c.json({ error: { message: "Current password is incorrect", code: "unauthorized" } }, 401);
  }

  const { hash, salt } = hashPassword(newPassword);
  writeAdminConfig({ ...cfg, passwordHash: hash, passwordSalt: salt });
  logger.info({ username: cfg.username }, "Admin password changed");
  return c.json({ success: true });
}
