/**
 * POST /v1/audio/transcriptions
 * OpenAI-compatible speech-to-text endpoint.
 * Accepts multipart/form-data with an audio file.
 */

import type { Context } from "hono";
import { routeRequest } from "../router/index.js";
import type { RequestContext } from "../types/provider.js";
import { randomUUID } from "crypto";

export async function audioTranscriptionHandler(c: Context): Promise<Response> {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json(
      { error: { message: "Expected multipart/form-data", type: "invalid_request_error" } },
      400
    );
  }

  const file = formData.get("file");
  if (!file) {
    return c.json(
      { error: { message: "Missing required field: file", type: "invalid_request_error" } },
      400
    );
  }

  const model = (formData.get("model") as string | null) ?? "whisper-large-v3-turbo";
  const requestId = randomUUID();

  const ctx: RequestContext = {
    requestId,
    modality: "stt",
    model,
    startTime: Date.now(),
  };

  return routeRequest(
    (provider) => {
      if (!provider.transcription) {
        throw new Error(`Provider ${provider.config.id} does not support transcription`);
      }
      return provider.transcription(formData, ctx);
    },
    ctx
  );
}
