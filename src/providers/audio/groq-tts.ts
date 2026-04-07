/**
 * Groq TTS provider using PlayAI Dialog models.
 * OpenAI-compatible audio/speech endpoint.
 */

import type { ChatCompletionRequest, AudioSpeechRequest } from "../../types/openai.js";
import type { RequestContext } from "../../types/provider.js";
import { BaseProvider } from "../base.js";

export class GroqTTSProvider extends BaseProvider {
  async chatCompletion(_req: ChatCompletionRequest, _ctx: RequestContext): Promise<Response> {
    throw new Error("Groq TTS is speech synthesis only — use speech()");
  }

  override async speech(req: AudioSpeechRequest, ctx: RequestContext): Promise<Response> {
    const url = `${this.config.baseUrl}/audio/speech`;

    const model = this.resolveModel(req.model);
    const body = {
      model,
      input: req.input,
      voice: req.voice ?? "Arista-PlayAI",
      response_format: req.response_format ?? "mp3",
    };

    const res = await this.fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      ctx
    );

    if (res.status === 429) {
      await this.rateLimitTracker.recordRateLimitError();
      throw new Error(`Rate limit exceeded for ${this.config.id}`);
    }
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Groq TTS error ${res.status}: ${errBody.slice(0, 200)}`);
    }

    await this.rateLimitTracker.recordSuccess(0);

    const contentType = res.headers.get("Content-Type") ?? "audio/mpeg";
    const audioData = await res.arrayBuffer();

    return new Response(audioData, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "X-Provider": this.config.id,
      },
    });
  }
}
