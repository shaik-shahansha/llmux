/**
 * POST /v1/audio/speech
 * OpenAI-compatible text-to-speech endpoint.
 * Returns raw audio bytes.
 */

import type { Context } from "hono";
import { z } from "zod";
import { routeRequest } from "../router/index.js";
import type { AudioSpeechRequest } from "../types/openai.js";
import type { RequestContext } from "../types/provider.js";
import { randomUUID } from "crypto";

const SpeechRequestSchema = z.object({
  model: z.string().min(1),
  input: z.string().min(1).max(4096),
  voice: z.string().default("alloy"),
  response_format: z.enum(["mp3", "opus", "aac", "flac", "wav", "pcm"]).optional().default("mp3"),
  speed: z.number().min(0.25).max(4.0).optional().default(1.0),
});

export async function audioSpeechHandler(c: Context): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { message: "Invalid JSON body", type: "invalid_request_error" } }, 400);
  }

  const parsed = SpeechRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { message: "Validation failed", type: "invalid_request_error" } },
      400
    );
  }

  const req = parsed.data as AudioSpeechRequest;
  const requestId = randomUUID();

  const ctx: RequestContext = {
    requestId,
    modality: "tts",
    model: req.model,
    startTime: Date.now(),
  };

  return routeRequest(
    (provider) => {
      if (!provider.speech) {
        throw new Error(`Provider ${provider.config.id} does not support TTS`);
      }
      return provider.speech(req, ctx);
    },
    ctx
  );
}
