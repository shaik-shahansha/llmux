/**
 * Google Gemini provider — custom adapter (not OpenAI-compatible).
 * Translates OpenAI chat format → Gemini generateContent API.
 * Free tier: 15 RPM, 1000 RPD, 250K TPM.
 * Models: Gemini 2.5 Pro/Flash/Flash-Lite.
 */

import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatMessage,
} from "../../types/openai.js";
import type { RequestContext } from "../../types/provider.js";
import { BaseProvider } from "../base.js";

interface GeminiContent {
  role: "user" | "model";
  parts: Array<{ text: string }>;
}

interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig?: {
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
    candidateCount?: number;
  };
}

interface GeminiResponse {
  candidates: Array<{
    content: { role: string; parts: Array<{ text: string }> };
    finishReason: string;
    index: number;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
  modelVersion?: string;
}

function openAIMessagesToGemini(messages: ChatMessage[]): {
  contents: GeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
} {
  const systemParts: string[] = [];
  const contents: GeminiContent[] = [];

  for (const msg of messages) {
    const textContent =
      typeof msg.content === "string"
        ? msg.content
        : msg.content?.filter((p) => p.type === "text")
            .map((p) => (p as { type: "text"; text: string }).text)
            .join("\n") ?? "";

    if (msg.role === "system") {
      systemParts.push(textContent);
    } else if (msg.role === "user") {
      contents.push({ role: "user", parts: [{ text: textContent }] });
    } else if (msg.role === "assistant") {
      contents.push({ role: "model", parts: [{ text: textContent }] });
    }
  }

  // Gemini requires alternating user/model turns — merge consecutive same-role
  const merged: GeminiContent[] = [];
  for (const item of contents) {
    const last = merged[merged.length - 1];
    if (last && last.role === item.role) {
      last.parts.push(...item.parts);
    } else {
      merged.push({ ...item, parts: [...item.parts] });
    }
  }

  // Gemini requires the last turn to be "user"
  if (merged.length > 0 && merged[merged.length - 1]?.role === "model") {
    merged.push({ role: "user", parts: [{ text: "Continue." }] });
  }

  if (systemParts.length > 0) {
    return { contents: merged, systemInstruction: { parts: [{ text: systemParts.join("\n") }] } };
  }
  return { contents: merged };
}

export class GeminiProvider extends BaseProvider {
  async chatCompletion(req: ChatCompletionRequest, ctx: RequestContext): Promise<Response> {
    const modelId = this.resolveModel(req.model);
    const apiKey = this.config.apiKey;

    const { contents, systemInstruction } = openAIMessagesToGemini(req.messages);

    const geminiReq: GeminiRequest = {
      contents,
      ...(systemInstruction && { systemInstruction }),
      generationConfig: {
        ...(req.temperature !== undefined && { temperature: req.temperature }),
        ...(req.top_p !== undefined && { topP: req.top_p }),
        ...(req.max_tokens !== undefined && { maxOutputTokens: req.max_tokens }),
        ...(req.stop && {
          stopSequences: Array.isArray(req.stop) ? req.stop : [req.stop],
        }),
      },
    };

    if (req.stream) {
      const url = `${this.config.baseUrl}/models/${modelId}:streamGenerateContent?alt=sse&key=${apiKey}`;
      const res = await this.fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(geminiReq),
        },
        ctx
      );

      if (res.status === 429) {
        await this.rateLimitTracker.recordRateLimitError();
        throw new Error(`Rate limit exceeded for ${this.config.id}`);
      }

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Gemini error ${res.status}: ${errBody.slice(0, 200)}`);
      }

      // Transform Gemini SSE → OpenAI SSE
      return this.transformGeminiStream(res, modelId, ctx);
    }

    const url = `${this.config.baseUrl}/models/${modelId}:generateContent?key=${apiKey}`;
    const res = await this.fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiReq),
      },
      ctx
    );

    if (res.status === 429) {
      await this.rateLimitTracker.recordRateLimitError();
      throw new Error(`Rate limit exceeded for ${this.config.id}`);
    }
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Gemini error ${res.status}: ${errBody.slice(0, 200)}`);
    }

    const geminiData = (await res.json()) as GeminiResponse;
    const openAIData = this.geminiToOpenAI(geminiData, modelId);

    const tokens = geminiData.usageMetadata?.totalTokenCount ?? ctx.estimatedTokens ?? 0;
    await this.recordTokens(ctx, tokens);

    return new Response(JSON.stringify(openAIData), {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Provider": this.config.id },
    });
  }

  private geminiToOpenAI(data: GeminiResponse, model: string): ChatCompletionResponse {
    const candidate = data.candidates[0];
    const text = candidate?.content.parts.map((p) => p.text).join("") ?? "";
    const finishReason =
      candidate?.finishReason === "STOP"
        ? "stop"
        : candidate?.finishReason === "MAX_TOKENS"
        ? "length"
        : "stop";

    return {
      id: `gemini-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: finishReason,
        },
      ],
      usage: {
        prompt_tokens: data.usageMetadata?.promptTokenCount ?? 0,
        completion_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        total_tokens: data.usageMetadata?.totalTokenCount ?? 0,
      },
    };
  }

  private transformGeminiStream(
    res: Response,
    model: string,
    ctx: RequestContext
  ): Response {
    const upstream = res.body!;
    const id = `gemini-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    let totalTokens = 0;
    const tracker = this.rateLimitTracker;

    const transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const text = new TextDecoder().decode(chunk);
        const lines = text.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;

          try {
            const gemChunk = JSON.parse(jsonStr) as GeminiResponse;
            const candidate = gemChunk.candidates?.[0];
            const content = candidate?.content.parts.map((p) => p.text).join("") ?? "";
            const done = candidate?.finishReason === "STOP" || candidate?.finishReason === "MAX_TOKENS";

            if (gemChunk.usageMetadata?.totalTokenCount) {
              totalTokens = gemChunk.usageMetadata.totalTokenCount;
            }

            const openAIChunk: ChatCompletionChunk = {
              id,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [
                {
                  index: 0,
                  delta: content ? { content } : {},
                  finish_reason: done ? "stop" : null,
                },
              ],
            };

            const encoded = new TextEncoder().encode(
              `data: ${JSON.stringify(openAIChunk)}\n\n`
            );
            controller.enqueue(encoded);

            if (done) {
              controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
            }
          } catch {
            // skip malformed chunks
          }
        }
      },
      flush: () => {
        void tracker.recordSuccess(totalTokens || ctx.estimatedTokens || 0);
      },
    });

    return new Response(upstream.pipeThrough(transform), {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Provider": this.config.id,
      },
    });
  }

  override async ping(): Promise<boolean> {
    if (!this.config.apiKey) return false;
    try {
      const res = await fetch(
        `${this.config.baseUrl}/models?key=${this.config.apiKey}`,
        { signal: AbortSignal.timeout(5000) }
      );
      return res.ok;
    } catch {
      return false;
    }
  }
}
