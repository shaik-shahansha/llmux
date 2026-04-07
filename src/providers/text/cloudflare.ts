/**
 * Cloudflare Workers AI text provider.
 * Custom adapter — CF uses a different endpoint structure.
 * Free tier: 10,000 neurons/day.
 * Models: Llama 3.3 70B, Llama 4 Scout.
 */

import type { ChatCompletionRequest, ChatCompletionResponse } from "../../types/openai.js";
import type { RequestContext } from "../../types/provider.js";
import { BaseProvider } from "../base.js";

interface CFMessage {
  role: string;
  content: string;
}

export class CloudflareTextProvider extends BaseProvider {
  async chatCompletion(req: ChatCompletionRequest, ctx: RequestContext): Promise<Response> {
    const modelId = this.resolveModel(req.model);
    const url = `${this.config.baseUrl}/${encodeURIComponent(modelId)}`;

    const messages: CFMessage[] = req.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    }));

    const cfBody = {
      messages,
      stream: req.stream ?? false,
      ...(req.temperature !== undefined && { temperature: req.temperature }),
      ...(req.max_tokens !== undefined && { max_tokens: req.max_tokens }),
    };

    const headers = {
      Authorization: `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json",
    };

    const res = await this.fetchWithTimeout(
      url,
      { method: "POST", headers, body: JSON.stringify(cfBody) },
      ctx
    );

    if (res.status === 429) {
      await this.rateLimitTracker.recordRateLimitError();
      throw new Error(`Rate limit exceeded for ${this.config.id}`);
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Cloudflare error ${res.status}: ${body.slice(0, 200)}`);
    }

    if (req.stream) {
      return this.proxyStream(res, ctx);
    }

    const cfData = await res.json() as { result?: { response?: string } };
    const text = cfData.result?.response ?? "";

    const openAIResp: ChatCompletionResponse = {
      id: `cf-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: ctx.estimatedTokens ? Math.floor(ctx.estimatedTokens * 0.4) : 0,
        completion_tokens: Math.ceil(text.length / 4),
        total_tokens: ctx.estimatedTokens ?? Math.ceil(text.length / 4),
      },
    };

    await this.recordTokens(ctx, openAIResp.usage.total_tokens);

    return new Response(JSON.stringify(openAIResp), {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Provider": this.config.id },
    });
  }

  override async ping(): Promise<boolean> {
    // Just check that credentials are set
    return !!(this.config.apiKey && this.config.accountId);
  }
}
