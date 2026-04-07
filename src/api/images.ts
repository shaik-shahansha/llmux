/**
 * POST /v1/images/generations
 * OpenAI-compatible image generation endpoint.
 */

import type { Context } from "hono";
import { z } from "zod";
import { routeRequest } from "../router/index.js";
import type { ImageGenerationRequest } from "../types/openai.js";
import type { RequestContext } from "../types/provider.js";
import { randomUUID } from "crypto";

const ImageRequestSchema = z.object({
  prompt: z.string().min(1).max(4000),
  model: z.string().optional(),
  n: z.number().int().min(1).max(10).optional().default(1),
  size: z
    .enum(["256x256", "512x512", "1024x1024", "1792x1024", "1024x1792"])
    .optional()
    .default("1024x1024"),
  quality: z.enum(["standard", "hd"]).optional().default("standard"),
  response_format: z.enum(["url", "b64_json"]).optional().default("url"),
  style: z.enum(["vivid", "natural"]).optional(),
  user: z.string().optional(),
});

export async function imagesHandler(c: Context): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { message: "Invalid JSON body", type: "invalid_request_error" } }, 400);
  }

  const parsed = ImageRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { message: "Validation failed", type: "invalid_request_error" } },
      400
    );
  }

  const req = parsed.data as ImageGenerationRequest;
  const requestId = randomUUID();

  const ctx: RequestContext = {
    requestId,
    modality: "image",
    model: req.model ?? "auto",
    startTime: Date.now(),
  };

  return routeRequest(
    (provider) => {
      if (!provider.imageGeneration) {
        throw new Error(`Provider ${provider.config.id} does not support image generation`);
      }
      return provider.imageGeneration(req, ctx);
    },
    ctx
  );
}
