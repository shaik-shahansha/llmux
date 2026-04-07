/**
 * POST /v1/completions
 * Legacy text completion endpoint.
 * Converts to chat completion internally (most providers dropped legacy completions).
 */

import type { Context } from "hono";
import { z } from "zod";
import { routeRequest } from "../router/index.js";
import { estimateChatTokens } from "../ratelimit/estimator.js";
import type { ChatCompletionRequest, CompletionRequest, CompletionResponse } from "../types/openai.js";
import type { RequestContext } from "../types/provider.js";
import { randomUUID } from "crypto";

const CompletionRequestSchema = z.object({
  model: z.string().min(1),
  prompt: z.union([z.string(), z.array(z.string())]),
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  n: z.number().int().positive().optional(),
  stream: z.boolean().optional().default(false),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  presence_penalty: z.number().optional(),
  frequency_penalty: z.number().optional(),
  user: z.string().optional(),
});

export async function completionsHandler(c: Context): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { message: "Invalid JSON body", type: "invalid_request_error" } }, 400);
  }

  const parsed = CompletionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { message: "Validation failed", type: "invalid_request_error" } },
      400
    );
  }

  const req = parsed.data as CompletionRequest;
  const promptText = Array.isArray(req.prompt) ? req.prompt.join("\n") : req.prompt;
  const requestId = randomUUID();

  // Convert legacy prompt → chat messages
  const chatReq: ChatCompletionRequest = {
    model: req.model,
    messages: [{ role: "user", content: promptText }],
    ...(req.max_tokens !== undefined && { max_tokens: req.max_tokens }),
    ...(req.temperature !== undefined && { temperature: req.temperature }),
    ...(req.top_p !== undefined && { top_p: req.top_p }),
    ...(req.stream !== undefined && { stream: req.stream }),
    ...(req.stop !== undefined && { stop: req.stop }),
    ...(req.n !== undefined && { n: req.n }),
  };

  const estimatedTokens = estimateChatTokens(chatReq.messages, req.max_tokens);

  const ctx: RequestContext = {
    requestId,
    modality: "text",
    model: req.model,
    estimatedTokens,
    ...(req.stream !== undefined && { stream: req.stream }),
    startTime: Date.now(),
  };

  if (req.stream) {
    return routeRequest((provider) => provider.chatCompletion(chatReq, ctx), ctx);
  }

  const chatResponse = await routeRequest(
    (provider) => provider.chatCompletion(chatReq, ctx),
    ctx
  );

  // Convert chat response → completions response format
  const chatData = await chatResponse.json() as {
    id: string;
    created: number;
    model: string;
    choices: Array<{ message: { content: string | null }; finish_reason: string | null }>;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  };

  const completionResp: CompletionResponse = {
    id: chatData.id,
    object: "text_completion",
    created: chatData.created,
    model: chatData.model,
    choices: chatData.choices.map((ch, i) => ({
      text: ch.message.content ?? "",
      index: i,
      finish_reason: ch.finish_reason,
      logprobs: null,
    })),
    usage: chatData.usage,
  };

  return new Response(JSON.stringify(completionResp), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
