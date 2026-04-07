/**
 * Anthropic provider — Claude API (paid).
 * Models: claude-opus-4, claude-sonnet-4, claude-haiku-3-5, etc.
 * Uses Anthropic's native API; adapts to OpenAI response format.
 */

import type { ChatCompletionRequest, ChatCompletionResponse, ChatMessage } from "../../types/openai.js";
import type { RequestContext } from "../../types/provider.js";
import { BaseProvider } from "../base.js";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | Array<{ type: string; text?: string }>;
}
interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
}
interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  model: string;
  content: Array<{ type: string; text: string }>;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

function toAnthropicMessages(messages: ChatMessage[]): { system?: string; messages: AnthropicMessage[] } {
  let system: string | undefined;
  const out: AnthropicMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      system = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    } else {
      out.push({ role: m.role as "user" | "assistant", content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) });
    }
  }
  const result: { system?: string; messages: AnthropicMessage[] } = { messages: out };
  if (system !== undefined) result.system = system;
  return result;
}


export class AnthropicProvider extends BaseProvider {
  async chatCompletion(req: ChatCompletionRequest, ctx: RequestContext): Promise<Response> {
    const model = this.resolveModel(req.model);
    const url = `${this.config.baseUrl}/messages`;

    const { system, messages } = toAnthropicMessages(req.messages);

    const body: AnthropicRequest = {
      model,
      max_tokens: req.max_tokens ?? 8192,
      messages,
      stream: req.stream ?? false,
    };
    if (system !== undefined) body.system = system;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.top_p !== undefined) body.top_p = req.top_p;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": this.config.apiKey ?? "",
      "anthropic-version": "2023-06-01",
    };

    const res = await this.doFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }, ctx);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic error ${res.status}: ${text}`);
    }

    if (req.stream) {
      // Anthropic SSE format differs slightly; proxy the raw stream and let client handle it
      return this.proxyStream(res, ctx);
    }

    const data = await res.json() as AnthropicResponse;
    const tokens = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);
    await this.recordTokens(ctx, tokens);

    // Convert Anthropic response to OpenAI format
    const openaiResp: ChatCompletionResponse = {
      id: data.id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: data.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: data.content.map((c) => c.text).join(""),
          },
          finish_reason: (data.stop_reason === "end_turn" ? "stop" : data.stop_reason) as "stop" | "length" | "tool_calls" | "content_filter" | null,
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: data.usage?.input_tokens ?? 0,
        completion_tokens: data.usage?.output_tokens ?? 0,
        total_tokens: tokens,
      },
    };

    return new Response(JSON.stringify(openaiResp), {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Provider": this.config.id },
    });
  }

  private async doFetch(url: string, init: RequestInit, ctx: RequestContext): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout ?? 30000);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      return res;
    } finally {
      clearTimeout(timeout);
    }
  }

  override async ping(): Promise<boolean> {
    if (!this.config.apiKey) return false;
    try {
      const res = await fetch(`${this.config.baseUrl}/models`, {
        headers: {
          "x-api-key": this.config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
