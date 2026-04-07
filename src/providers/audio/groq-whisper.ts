/**
 * Groq Whisper STT provider.
 * 299× real-time Whisper on LPU hardware.
 * Free: 20 RPM, 2,000 RPD.
 * Models: whisper-large-v3-turbo, whisper-large-v3, distil-whisper-large-v3-en.
 */

import type { ChatCompletionRequest, AudioTranscriptionResponse } from "../../types/openai.js";
import type { RequestContext } from "../../types/provider.js";
import { BaseProvider } from "../base.js";

export class GroqWhisperProvider extends BaseProvider {
  async chatCompletion(_req: ChatCompletionRequest, _ctx: RequestContext): Promise<Response> {
    throw new Error("Groq Whisper is STT only — use transcription()");
  }

  override async transcription(formData: FormData, ctx: RequestContext): Promise<Response> {
    const url = `${this.config.baseUrl}/audio/transcriptions`;

    // Set model if not specified in formData
    if (!formData.get("model")) {
      const defaultModel = this.config.models[0]?.id ?? "whisper-large-v3-turbo";
      formData.set("model", defaultModel);
    } else {
      // Resolve alias
      const reqModel = formData.get("model") as string;
      formData.set("model", this.resolveModel(reqModel));
    }

    const res = await this.fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        body: formData,
      },
      ctx
    );

    if (res.status === 429) {
      await this.rateLimitTracker.recordRateLimitError();
      throw new Error(`Rate limit exceeded for ${this.config.id}`);
    }
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Groq Whisper error ${res.status}: ${errBody.slice(0, 200)}`);
    }

    await this.rateLimitTracker.recordSuccess(0);

    const data = (await res.json()) as AudioTranscriptionResponse;
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Provider": this.config.id },
    });
  }

  override async ping(): Promise<boolean> {
    if (!this.config.apiKey) return false;
    try {
      const res = await fetch(`${this.config.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
