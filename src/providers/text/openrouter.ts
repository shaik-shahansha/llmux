/**
 * OpenRouter provider — OpenAI-compatible aggregator gateway.
 * 28+ free models including DeepSeek R1, Llama 3.3, Qwen3 Coder.
 * Free tier: 20 RPM / 50 RPD (base) or 1,000 RPD with $10 deposit.
 */

import type { ChatCompletionRequest } from "../../types/openai.js";
import type { RequestContext } from "../../types/provider.js";
import { BaseProvider } from "../base.js";

export class OpenRouterProvider extends BaseProvider {
  async chatCompletion(req: ChatCompletionRequest, ctx: RequestContext): Promise<Response> {
    const model = this.resolveModel(req.model);
    const url = `${this.config.baseUrl}/chat/completions`;

    const res = await this.postJSON(url, { ...req, model }, ctx);

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
}
