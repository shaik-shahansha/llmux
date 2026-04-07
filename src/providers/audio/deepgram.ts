/**
 * Deepgram provider — handles both TTS (Aura-2) and STT (Nova-3).
 * $200 free credits on signup (enormous free tier).
 * STT: 40× faster than competitors, 45+ languages.
 * TTS: sub-250ms latency, Aura-2 voices.
 */

import type { ChatCompletionRequest, AudioSpeechRequest, AudioTranscriptionResponse } from "../../types/openai.js";
import type { RequestContext } from "../../types/provider.js";
import { BaseProvider } from "../base.js";

export class DeepgramProvider extends BaseProvider {
  async chatCompletion(_req: ChatCompletionRequest, _ctx: RequestContext): Promise<Response> {
    throw new Error("Deepgram is audio-only — use speech() or transcription()");
  }

  // ── TTS ───────────────────────────────────────────────────────────────────

  override async speech(req: AudioSpeechRequest, ctx: RequestContext): Promise<Response> {
    const voice = req.voice ?? "aura-2-en-us";
    const encoding = this.mapFormat(req.response_format ?? "mp3");
    const url = `${this.config.baseUrl}/speak?model=${voice}&encoding=${encoding}`;

    const body = { text: req.input };

    const res = await this.fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${this.config.apiKey}`,
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
      throw new Error(`Deepgram TTS error ${res.status}: ${errBody.slice(0, 200)}`);
    }

    await this.rateLimitTracker.recordSuccess(0);
    const audioData = await res.arrayBuffer();

    return new Response(audioData, {
      status: 200,
      headers: {
        "Content-Type": this.contentType(req.response_format ?? "mp3"),
        "X-Provider": this.config.id,
      },
    });
  }

  // ── STT ───────────────────────────────────────────────────────────────────

  override async transcription(formData: FormData, ctx: RequestContext): Promise<Response> {
    const model = (formData.get("model") as string | null)
      ? this.resolveModel(formData.get("model") as string)
      : "nova-3";
    const language = (formData.get("language") as string | null) ?? "en";
    const audioFile = formData.get("file") as File | Blob | null;

    if (!audioFile) {
      throw new Error("No audio file provided");
    }

    const url = `${this.config.baseUrl}/listen?model=${model}&language=${language}&punctuate=true&smart_format=true`;

    const audioBuffer = await audioFile.arrayBuffer();

    const res = await this.fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${this.config.apiKey}`,
          "Content-Type": audioFile instanceof File ? (audioFile.type || "audio/wav") : "audio/wav",
        },
        body: audioBuffer,
      },
      ctx
    );

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Deepgram STT error ${res.status}: ${errBody.slice(0, 200)}`);
    }

    await this.rateLimitTracker.recordSuccess(0);

    const deepgramData = await res.json() as {
      results?: {
        channels?: Array<{
          alternatives?: Array<{ transcript: string; words?: unknown[] }>;
        }>;
      };
      metadata?: { duration: number };
    };

    const transcript = deepgramData.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";

    const response: AudioTranscriptionResponse = {
      text: transcript,
      language: language,
      ...(deepgramData.metadata?.duration !== undefined && { duration: deepgramData.metadata.duration }),
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Provider": this.config.id },
    });
  }

  private mapFormat(format: string): string {
    const map: Record<string, string> = {
      mp3: "mp3", opus: "opus", aac: "aac", flac: "flac", wav: "linear16", pcm: "linear16",
    };
    return map[format] ?? "mp3";
  }

  private contentType(format: string): string {
    const map: Record<string, string> = {
      mp3: "audio/mpeg", opus: "audio/opus", aac: "audio/aac",
      flac: "audio/flac", wav: "audio/wav", pcm: "audio/pcm",
    };
    return map[format] ?? "audio/mpeg";
  }
}
