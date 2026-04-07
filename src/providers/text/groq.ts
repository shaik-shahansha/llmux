/**
 * Groq provider — OpenAI-compatible API.
 * Fastest free LPU inference: 300-500+ tokens/second.
 * Models: Llama 3.3 70B, Llama 4 Scout, Qwen3-32B, etc.
 */

import type { ChatCompletionRequest } from "../../types/openai.js";
import type { RequestContext } from "../../types/provider.js";
import { BaseProvider } from "../base.js";

export class GroqProvider extends BaseProvider {
  async chatCompletion(req: ChatCompletionRequest, ctx: RequestContext): Promise<Response> {
    const model = this.resolveModel(req.model);
    const url = `${this.config.baseUrl}/chat/completions`;

    const body = { ...req, model };
    const res = await this.postJSON(url, body, ctx);

    if (req.stream) {
      return this.proxyStream(res, ctx);
    }

    const data = await res.json();
    const tokens = (data as { usage?: { total_tokens?: number } }).usage?.total_tokens ?? ctx.estimatedTokens ?? 0;
    await this.recordTokens(ctx, tokens);

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
