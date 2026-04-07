/**
 * Global error handler middleware.
 * Converts thrown errors into OpenAI-compatible JSON error responses.
 */

import type { Context } from "hono";
import type { OpenAIError } from "../types/openai.js";
import { logger } from "./logger.js";

export function handleError(err: Error, c: Context): Response {
  logger.error({ err, path: c.req.path, method: c.req.method }, "Unhandled error");

  const message = err.message ?? "An unexpected error occurred";

  let statusCode = 500;
  let errorType = "internal_error";
  let code: string | null = null;

  if (message.includes("Rate limit") || message.includes("rate_limit")) {
    statusCode = 429;
    errorType = "rate_limit_error";
    code = "rate_limit_exceeded";
  } else if (message.includes("No providers available")) {
    statusCode = 503;
    errorType = "service_unavailable";
    code = "no_providers_available";
  } else if (message.includes("All providers failed")) {
    statusCode = 502;
    errorType = "provider_error";
    code = "all_providers_failed";
  } else if (message.includes("timed out")) {
    statusCode = 504;
    errorType = "timeout_error";
    code = "request_timeout";
  }

  const error: OpenAIError = {
    error: {
      message,
      type: errorType,
      code,
    },
  };

  return c.json(error, statusCode as 429 | 500 | 503 | 502 | 504);
}
