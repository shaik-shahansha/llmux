/**
 * API key authentication middleware for the LLMux gateway.
 * If GATEWAY_API_KEY is set, all requests must include:
 *   Authorization: Bearer <key>
 * If GATEWAY_API_KEY is unset, all requests pass through (dev mode).
 */

import type { Context, Next } from "hono";
import type { OpenAIError } from "../types/openai.js";
import { getActiveGatewayApiKeys } from "../config/admin-store.js";

export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  // All active keys: named stored keys + GATEWAY_API_KEY env var
  const activeKeys = getActiveGatewayApiKeys();

  // Auth not configured — allow all
  if (activeKeys.length === 0) {
    return next();
  }

  const authHeader = c.req.header("Authorization");
  if (!authHeader) {
    const error: OpenAIError = {
      error: {
        message: "Missing Authorization header. Provide: Authorization: Bearer <api_key>",
        type: "invalid_request_error",
        code: "missing_api_key",
      },
    };
    return c.json(error, 401);
  }

  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : authHeader.trim();

  if (!activeKeys.includes(token)) {
    const error: OpenAIError = {
      error: {
        message: "Invalid API key.",
        type: "invalid_request_error",
        code: "invalid_api_key",
      },
    };
    return c.json(error, 401);
  }

  return next();
}

