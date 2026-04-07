/**
 * Cohere provider — custom adapter (non-OpenAI-compatible API).
 * Translates OpenAI chat messages → Cohere Chat API v2 format.
 * Free tier: 1,000 calls/month, 20 RPM.
 * Models: Command A (256K ctx), Command R+.
 */

import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
} from "../../types/openai.js";
import type { RequestContext } from "../../types/provider.js";
import { BaseProvider } from "../base.js";

interface CohereMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
}

interface CohereRequest {
  model: string;
  messages: CohereMessage[];
  temperature?: number;
  p?: number;
  max_tokens?: number;
  stop_sequences?: string[];
  stream?: boolean;
}

interface CohereResponse {
  id: string;
  message: {
    role: string;
    content: Array<{ type: string; text: string }>;
  };
  finish_reason: string;
  usage: {
    billed_units: { input_tokens: number; output_tokens: number };
    tokens: { input_tokens: number; output_tokens: number };
  };
  model?: string;
}

function toCohereMessages(messages: ChatMessage[]): CohereMessage[] {
  return messages.map((m) => ({
    role: (m.role === "system" ? "system" : m.role === "assistant" ? "assistant" : "user") as CohereMessage["role"],
    content: typeof m.content === "string"
      ? m.content
      : m.content?.filter((p) => p.type === "text")
          .map((p) => (p as { type: "text"; text: string }).text)
          .join("\n") ?? "",
  }));
}

export class CohereProvider extends BaseProvider {
  async chatCompletion(req: ChatCompletionRequest, ctx: RequestContext): Promise<Response> {
    const model = this.resolveModel(req.model);
    const url = `${this.config.baseUrl}/chat`;

    const cohereReq: CohereRequest = {
      model,
      messages: toCohereMessages(req.messages),
      ...(req.temperature !== undefined && { temperature: req.temperature }),
      ...(req.top_p !== undefined && { p: req.top_p }),
      ...(req.max_tokens !== undefined && { max_tokens: req.max_tokens }),
      ...(req.stop && {
        stop_sequences: Array.isArray(req.stop) ? req.stop : [req.stop],
      }),
      stream: req.stream ?? false,
    };

    const headers = {
      Authorization: `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    const res = await this.fetchWithTimeout(
      url,
      { method: "POST", headers, body: JSON.stringify(cohereReq) },
      ctx
    );

    if (res.status === 429) {
      await this.rateLimitTracker.recordRateLimitError();
      throw new Error(`Rate limit exceeded for ${this.config.id}`);
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Cohere error ${res.status}: ${body.slice(0, 200)}`);
    }

    if (req.stream) {
      // Cohere has its own streaming format — proxy as-is and convert
      return this.proxyCohereStream(res, model, ctx);
    }

    const cohereData = (await res.json()) as CohereResponse;
    const text = cohereData.message.content.map((c) => c.text).join("");
    const promptTokens = cohereData.usage.tokens.input_tokens;
    const completionTokens = cohereData.usage.tokens.output_tokens;

    const openAIResp: ChatCompletionResponse = {
      id: cohereData.id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: cohereData.finish_reason === "COMPLETE" ? "stop" : "length",
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    };

    await this.recordTokens(ctx, openAIResp.usage.total_tokens);

    return new Response(JSON.stringify(openAIResp), {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Provider": this.config.id },
    });
  }

  private proxyCohereStream(res: Response, model: string, ctx: RequestContext): Response {
    // Cohere streams NDJSON — convert each event to OpenAI SSE
    const upstream = res.body!;
    const id = `cohere-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    let totalTokens = 0;
    const tracker = this.rateLimitTracker;

    const transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const text = new TextDecoder().decode(chunk);
        for (const line of text.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const event = JSON.parse(trimmed) as {
              type: string;
              delta?: { message?: { content?: Array<{ type: string; text: string }> } };
              usage?: { tokens?: { input_tokens: number; output_tokens: number } };
              finish_reason?: string;
            };

            if (event.type === "content-delta") {
              const content = event.delta?.message?.content?.[0]?.text ?? "";
              const openAIChunk = {
                id, object: "chat.completion.chunk", created, model,
                choices: [{ index: 0, delta: { content }, finish_reason: null }],
              };
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(openAIChunk)}\n\n`));
            } else if (event.type === "message-end") {
              if (event.usage?.tokens) {
                totalTokens = event.usage.tokens.input_tokens + event.usage.tokens.output_tokens;
              }
              const doneChunk = {
                id, object: "chat.completion.chunk", created, model,
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              };
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(doneChunk)}\n\n`));
              controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
            }
          } catch {
            // ignore
          }
        }
      },
      flush: () => {
        void tracker.recordSuccess(totalTokens || ctx.estimatedTokens || 0);
      },
    });

    return new Response(upstream.pipeThrough(transform), {
      status: 200,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Provider": this.config.id },
    });
  }
}
