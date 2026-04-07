/**
 * POST /api/admin/playground/chat
 * Admin-only playground endpoint that routes directly to a specific provider
 * by ID, bypassing the normal router strategy. The client sends `provider_id`
 * in the request body to pin the provider.
 */

import type { Context } from "hono";
import { z } from "zod";
import { registry } from "../../providers/registry.js";
import { estimateChatTokens } from "../../ratelimit/estimator.js";
import { requestLog } from "../../ratelimit/requestlog.js";
import type { ChatCompletionRequest } from "../../types/openai.js";
import type { RequestContext } from "../../types/provider.js";
import { randomUUID } from "crypto";

const PlaygroundRequestSchema = z.object({
  provider_id: z.string().min(1),
  model: z.string().min(1),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant", "tool", "function"]),
        content: z.union([z.string(), z.array(z.unknown()), z.null()]),
        name: z.string().optional(),
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
  seed: z.number().int().optional(),
});

export async function playgroundChatHandler(c: Context): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { message: "Invalid JSON body", type: "invalid_request_error" } }, 400);
  }

  const parsed = PlaygroundRequestSchema.safeParse(body);
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

  const { provider_id, ...rest } = parsed.data;

  // Look up the specific provider by ID
  const provider = registry.getById(provider_id);
  if (!provider) {
    return c.json(
      {
        error: {
          message: `Provider "${provider_id}" not found or not loaded (check API key is configured)`,
          type: "invalid_request_error",
          code: "provider_not_found",
        },
      },
      404
    );
  }

  const req = rest as ChatCompletionRequest;
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

  try {
    const response = await provider.chatCompletion(req, ctx);
    // Attach X-Provider header so the UI can show which provider responded
    const headers = new Headers(response.headers);
    headers.set("X-Provider", provider_id);

    // Log to request log so dashboard stats are updated.
    // For streaming requests, the token count will be updated later by
    // base.proxyStream's flush → requestLog.updateTokens().
    // For non-streaming, we clone and parse the full JSON to get real token usage.
    let tokensUsed = estimatedTokens;
    const responseToReturn = new Response(response.body, { status: response.status, headers });

    if (!req.stream) {
      try {
        const clone = responseToReturn.clone();
        const data = await clone.json() as { usage?: { total_tokens?: number } };
        tokensUsed = data.usage?.total_tokens ?? estimatedTokens;
      } catch { /* use estimate on parse error */ }
    }

    requestLog.record({
      id: requestId,
      ts: Date.now(),
      modality: "text",
      model: req.model,
      provider: provider_id,
      status: "success",
      latencyMs: Date.now() - ctx.startTime,
      tokensUsed,
      fallbackFrom: [],
    });

    return responseToReturn;
  } catch (err) {
    requestLog.record({
      id: requestId,
      ts: Date.now(),
      modality: "text",
      model: req.model,
      provider: provider_id,
      status: "error",
      latencyMs: Date.now() - ctx.startTime,
      tokensUsed: 0,
      fallbackFrom: [],
    });
    const msg = err instanceof Error ? err.message : "Provider request failed";
    return c.json({ error: { message: msg, type: "provider_error" } }, 502);
  }
}
