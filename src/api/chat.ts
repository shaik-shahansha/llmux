/**
 * POST /v1/chat/completions
 * OpenAI-compatible chat completion endpoint.
 * Supports streaming (SSE) and non-streaming responses.
 */

import type { Context } from "hono";
import { z } from "zod";
import { routeRequest } from "../router/index.js";
import { estimateChatTokens } from "../ratelimit/estimator.js";
import type { ChatCompletionRequest } from "../types/openai.js";
import type { RequestContext } from "../types/provider.js";
import { logger } from "../middleware/logger.js";
import { randomUUID } from "crypto";

const ChatRequestSchema = z.object({
  model: z.string().min(1),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant", "tool", "function"]),
        content: z.union([z.string(), z.array(z.unknown()), z.null()]),
        name: z.string().optional(),
        tool_call_id: z.string().optional(),
        tool_calls: z.array(z.unknown()).optional(),
      })
    )
    .min(1),
  stream: z.boolean().optional().default(false),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().int().positive().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  n: z.number().int().positive().max(8).optional(),
  user: z.string().optional(),
  tools: z.array(z.unknown()).optional(),
  tool_choice: z.unknown().optional(),
  response_format: z.unknown().optional(),
  seed: z.number().int().optional(),
  logprobs: z.boolean().optional(),
  top_logprobs: z.number().int().min(0).max(20).optional(),
});

export async function chatCompletionsHandler(c: Context): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { message: "Invalid JSON body", type: "invalid_request_error" } }, 400);
  }

  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          type: "invalid_request_error",
        },
      },
      400
    );
  }

  const req = parsed.data as ChatCompletionRequest;
  const requestId = randomUUID();
  const estimatedTokens = estimateChatTokens(req.messages, req.max_tokens);

  const ctx: RequestContext = {
    requestId,
    modality: "text",
    model: req.model,
    estimatedTokens,
    ...(req.stream !== undefined && { stream: req.stream }),
    startTime: Date.now(),
  };

  logger.info(
    { requestId, model: req.model, stream: req.stream, estimatedTokens },
    "Chat completion request"
  );

  return routeRequest((provider) => provider.chatCompletion(req, ctx), ctx);
}
