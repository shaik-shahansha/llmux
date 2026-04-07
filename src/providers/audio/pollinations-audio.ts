/**
 * Pollinations AI audio provider — TTS + STT.
 * Base URL: https://gen.pollinations.ai
 * Docs: https://github.com/pollinations/pollinations/blob/main/APIDOCS.md
 *
 * TTS: POST /v1/audio/speech — OpenAI-compatible TTS.
 *   Supports music generation via model=elevenmusic.
 *   30+ voices: alloy, echo, nova, shimmer, rachel, josh, etc.
 * STT: POST /v1/audio/transcriptions — OpenAI Whisper-compatible.
 *   Models: whisper-large-v3, scribe (ElevenLabs, 90+ languages).
 */

import type { ChatCompletionRequest, AudioSpeechRequest } from "../../types/openai.js";
import type { RequestContext } from "../../types/provider.js";
import { BaseProvider } from "../base.js";

export class PollinationsAudioProvider extends BaseProvider {
  // Required by abstract base class — not used for audio providers
  async chatCompletion(_req: ChatCompletionRequest, _ctx: RequestContext): Promise<Response> {
    throw new Error("PollinationsAudioProvider does not support text completion");
  }

  override async speech(req: AudioSpeechRequest, ctx: RequestContext): Promise<Response> {
    const url = `${this.config.baseUrl}/v1/audio/speech`;

    const body: Record<string, unknown> = {
      model: req.model ?? "tts-1",
      input: req.input,
      voice: req.voice ?? "alloy",
      response_format: req.response_format ?? "mp3",
      speed: req.speed ?? 1,
    };

    const headers = this.buildHeaders({ "Content-Type": "application/json" });
    const res = await this.fetchWithTimeout(
      url,
      { method: "POST", headers, body: JSON.stringify(body) },
      ctx
    );

    if (res.status === 429) {
      await this.rateLimitTracker.recordRateLimitError();
      (this.health as { consecutiveErrors: number }).consecutiveErrors++;
      this.rotateApiKey();
      throw new Error(`Rate limited on Pollinations TTS`);
    }

    if (!res.ok) {
      (this.health as { consecutiveErrors: number }).consecutiveErrors++;
      throw new Error(`Pollinations TTS error: ${res.status} ${await res.text()}`);
    }

    (this.health as { consecutiveErrors: number; status: string }).consecutiveErrors = 0;
    (this.health as { status: string }).status = "healthy";
    await this.rateLimitTracker.recordSuccess(0);

    const audioData = await res.arrayBuffer();
    const contentType = res.headers.get("Content-Type") ?? "audio/mpeg";
    return new Response(audioData, {
      status: 200,
      headers: { "Content-Type": contentType, "X-Provider": this.config.id },
    });
  }

  override async transcription(formData: FormData, ctx: RequestContext): Promise<Response> {
    const url = `${this.config.baseUrl}/v1/audio/transcriptions`;

    const apiKey = this.getCurrentApiKey();
    const headers: Record<string, string> = { "X-Provider": this.config.id };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const res = await this.fetchWithTimeout(url, { method: "POST", headers, body: formData }, ctx);

    if (res.status === 429) {
      await this.rateLimitTracker.recordRateLimitError();
      this.rotateApiKey();
      throw new Error(`Rate limited on Pollinations STT`);
    }

    if (!res.ok) {
      throw new Error(`Pollinations STT error: ${res.status} ${await res.text()}`);
    }

    await this.rateLimitTracker.recordSuccess(0);
    const data = await res.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Provider": this.config.id },
    });
  }

  override async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.baseUrl}/audio/models`, {
        signal: AbortSignal.timeout(8000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
