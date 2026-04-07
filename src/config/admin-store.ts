/**
 * Admin credential + JWT store.
 * Persists to config/admin.json (never committed — in .gitignore).
 * Uses Node crypto.scrypt for password hashing (no extra deps).
 * Uses Web Crypto API (built-in Node 18+) for JWT signing.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "crypto";

const ADMIN_CONFIG_PATH = resolve("config/admin.json");
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, dkLen: 64 };
const JWT_EXPIRY_SECONDS = 8 * 60 * 60; // 8 hours

export interface GatewayApiKey {
  id: string;        // uuid
  name: string;      // human label, e.g. "Production"
  hint: string;      // first 8 chars for display (never the full key)
  createdAt: string; // ISO timestamp
}

export interface AdminConfig {
  setupComplete: boolean;
  username: string;
  passwordHash: string;   // scrypt hex
  passwordSalt: string;   // hex
  jwtSecret: string;      // hex random 64 bytes
  /** Array of named gateway API keys. Full key values are NOT stored here (only hints). */
  gatewayApiKeys?: GatewayApiKey[];
  /** Raw key values indexed by id — stored separately so hints stay clean. */
  gatewayApiKeyValues?: Record<string, string>;
}

// ── Persistence ───────────────────────────────────────────────────────────────

function ensureConfigDir(): void {
  const dir = resolve("config");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function readAdminConfig(): AdminConfig | null {
  if (!existsSync(ADMIN_CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(ADMIN_CONFIG_PATH, "utf8")) as AdminConfig;
  } catch {
    return null;
  }
}

export function writeAdminConfig(cfg: AdminConfig): void {
  ensureConfigDir();
  // Atomic-ish write: write then rename would be ideal but fs.renameSync is fine here
  writeFileSync(ADMIN_CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export function isSetupComplete(): boolean {
  const cfg = readAdminConfig();
  return cfg?.setupComplete === true;
}

// ── Password hashing ──────────────────────────────────────────────────────────

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(32);
  const hash = scryptSync(password, salt, SCRYPT_PARAMS.dkLen, {
    N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p,
  });
  return { hash: hash.toString("hex"), salt: salt.toString("hex") };
}

export function verifyPassword(password: string, hashHex: string, saltHex: string): boolean {
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, SCRYPT_PARAMS.dkLen, {
    N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p,
  });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

// ── JWT (HS256, no external dep) ──────────────────────────────────────────────

function b64url(buf: Buffer | string): string {
  const s = typeof buf === "string" ? buf : buf.toString("base64");
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function signJWT(payload: Record<string, unknown>, secret: string): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64"));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(Buffer.from(JSON.stringify({ ...payload, iat: now, exp: now + JWT_EXPIRY_SECONDS })).toString("base64"));
  const sig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64");
  return `${header}.${body}.${b64url(sig)}`;
}

export function verifyJWT(token: string, secret: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const header = parts[0] as string;
  const body = parts[1] as string;
  const sig = parts[2] as string;
  const expected = b64url(createHmac("sha256", secret).update(`${header}.${body}`).digest("base64"));
  if (expected !== sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, unknown>;
    if (typeof payload["exp"] === "number" && payload["exp"] < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Gateway API key management (named, multi-key) ───────────────────────────────

/**
 * Creates a new named key, stores it, and returns the raw key value (one-time).
 * The raw value is kept in `gatewayApiKeyValues` (indexed by id); callers
 * should never expose this except at creation time.
 */
export function createGatewayApiKey(name: string): { meta: GatewayApiKey; key: string } {
  const cfg = readAdminConfig();
  if (!cfg) throw new Error("Admin not set up");
  const raw = "lmx_" + randomBytes(36).toString("base64url");
  const id = randomBytes(8).toString("hex");
  const meta: GatewayApiKey = {
    id,
    name: name.trim() || "Unnamed",
    hint: raw.slice(0, 10) + "••••",
    createdAt: new Date().toISOString(),
  };
  const keys = cfg.gatewayApiKeys ?? [];
  const values = cfg.gatewayApiKeyValues ?? {};
  writeAdminConfig({
    ...cfg,
    gatewayApiKeys: [...keys, meta],
    gatewayApiKeyValues: { ...values, [id]: raw },
  });
  return { meta, key: raw };
}

/** Returns metadata for all stored keys (no raw values). */
export function listGatewayApiKeys(): GatewayApiKey[] {
  return readAdminConfig()?.gatewayApiKeys ?? [];
}

/** Deletes a stored key by id. Returns true if found and deleted. */
export function deleteGatewayApiKey(id: string): boolean {
  const cfg = readAdminConfig();
  if (!cfg) return false;
  const keys = cfg.gatewayApiKeys ?? [];
  const after = keys.filter((k) => k.id !== id);
  if (after.length === keys.length) return false;
  const values = { ...(cfg.gatewayApiKeyValues ?? {}) };
  delete values[id];
  writeAdminConfig({ ...cfg, gatewayApiKeys: after, gatewayApiKeyValues: values });
  return true;
}

/**
 * Returns all active raw key values: the stored named keys
 * PLUS the GATEWAY_API_KEY env var if set.
 * Used by auth middleware to validate incoming bearer tokens.
 */
export function getActiveGatewayApiKeys(): string[] {
  const cfg = readAdminConfig();
  const stored = Object.values(cfg?.gatewayApiKeyValues ?? {});
  const env = process.env["GATEWAY_API_KEY"];
  if (env) stored.push(env);
  return stored;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

export function createAdmin(username: string, password: string): void {
  if (username.length < 3) throw new Error("Username must be at least 3 characters");
  if (password.length < 8) throw new Error("Password must be at least 8 characters");
  const { hash, salt } = hashPassword(password);
  const jwtSecret = randomBytes(64).toString("hex");
  writeAdminConfig({
    setupComplete: true,
    username,
    passwordHash: hash,
    passwordSalt: salt,
    jwtSecret,
  });
}
