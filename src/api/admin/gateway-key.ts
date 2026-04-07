/**
 * Gateway API Key management — admin-protected endpoints.
 *
 * GET    /api/admin/gateway-key            — list key metadata (no raw values)
 * POST   /api/admin/gateway-key            — create a named key (one-time raw value in response)
 * DELETE /api/admin/gateway-key/:id        — delete a specific key by id
 */

import type { Context } from "hono";
import {
  createGatewayApiKey,
  listGatewayApiKeys,
  deleteGatewayApiKey,
} from "../../config/admin-store.js";
import { logger } from "../../middleware/logger.js";

/** Returns metadata for all stored keys. Raw values are never returned. */
export async function listGatewayKeys(c: Context): Promise<Response> {
  const keys = listGatewayApiKeys();
  const envKeySet = Boolean(process.env["GATEWAY_API_KEY"]);

  return c.json({
    keys,
    envKeyActive: envKeySet,
    total: keys.length + (envKeySet ? 1 : 0),
  });
}

/**
 * Creates a new named key.
 * Body: { name: string }
 * Returns the raw key ONE TIME — it cannot be retrieved again.
 */
export async function createGatewayKey(c: Context): Promise<Response> {
  let body: { name?: string } = {};
  try { body = await c.req.json() as { name?: string }; } catch { /* empty body = unnamed */ }

  const name = (body.name ?? "").trim() || "Unnamed";
  const { meta, key } = createGatewayApiKey(name);

  logger.info({ id: meta.id, name }, "Gateway API key created via admin UI");

  return c.json({
    meta,
    key,
    message: "Copy this key now — it will not be shown again.",
  }, 201);
}

/** Deletes a stored key by id. */
export async function deleteGatewayKey(c: Context): Promise<Response> {
  const id = c.req.param("id") ?? "";
  if (!id) {
    return c.json({ error: { message: "Missing key id." } }, 400);
  }
  const deleted = deleteGatewayApiKey(id);

  if (!deleted) {
    return c.json({ error: { message: `Key "${id}" not found.` } }, 404);
  }

  logger.info({ id }, "Gateway API key deleted via admin UI");
  return c.json({ deleted: true, id });
}
