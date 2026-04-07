/**
 * ElevenLabs TTS provider.
 * Industry-leading voice quality.
 * Free: 10,000 chars/month (~10 min audio).
 * Models: eleven_flash_v2_5, eleven_multilingual_v2.
 */

import type { ChatCompletionRequest, AudioSpeechRequest } from "../../types/openai.js";
import type { RequestContext } from "../../types/provider.js";
import { BaseProvider } from "../base.js";

// ElevenLabs voice ID map (OpenAI voice names → ElevenLabs voice IDs)
const VOICE_MAP: Record<string, string> = {
  alloy: "EXAVITQu4vr4xnSDxMaL",      // Sarah
  echo: "TX3LPaxmHKxFdv7VOQHJ",        // Liam
  fable: "XB0fDUnXU5powFXDhCwa",       // Charlotte
  onyx: "GBv7mTt0atIp3Br8iCZE",        // Thomas
  nova: "FGY2WhTYpPnrIDTdsKH5",        // Laura
  shimmer: "jsCqWAovK2LkecY7zXl4",     // Freya
};

export class ElevenLabsProvider extends BaseProvider {
  async chatCompletion(_req: ChatCompletionRequest, _ctx: RequestContext): Promise<Response> {
    throw new Error("ElevenLabs is TTS only — use speech()");
  }

  override async speech(req: AudioSpeechRequest, ctx: RequestContext): Promise<Response> {
    const modelId = this.resolveModel(req.model);
    const voiceId = VOICE_MAP[req.voice] ?? req.voice ?? VOICE_MAP["alloy"]!;

    const outputFormat = this.mapFormat(req.response_format ?? "mp3");
    const url = `${this.config.baseUrl}/text-to-speech/${voiceId}?output_format=${outputFormat}`;

    const body = {
      text: req.input,
      model_id: modelId,
      voice_settings: {
        speed: req.speed ?? 1.0,
        stability: 0.5,
        similarity_boost: 0.75,
      },
    };

    const res = await this.fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "xi-api-key": this.config.apiKey ?? "",
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
      throw new Error(`ElevenLabs error ${res.status}: ${errBody.slice(0, 200)}`);
    }

    await this.rateLimitTracker.recordSuccess(req.input.length);

    const contentType = res.headers.get("Content-Type") ?? "audio/mpeg";
    const audioData = await res.arrayBuffer();

    return new Response(audioData, {
      status: 200,
      headers: { "Content-Type": contentType, "X-Provider": this.config.id },
    });
  }

  private mapFormat(format: string): string {
    const map: Record<string, string> = {
      mp3: "mp3_44100_128",
      opus: "opus_48000_32",
      aac: "aac_44100_128",
      flac: "pcm_44100",
      wav: "pcm_44100",
      pcm: "pcm_44100",
    };
    return map[format] ?? "mp3_44100_128";
  }
}
