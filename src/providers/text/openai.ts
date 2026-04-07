/**
 * OpenAI provider — official OpenAI API (paid).
 * Models: gpt-4o, gpt-4o-mini, o1, o3, o4-mini, etc.
 * Pricing tracked for dashboard cost display.
 */

import type { ChatCompletionRequest } from "../../types/openai.js";
import type { RequestContext } from "../../types/provider.js";
import { BaseProvider } from "../base.js";

export class OpenAIProvider extends BaseProvider {
  async chatCompletion(req: ChatCompletionRequest, ctx: RequestContext): Promise<Response> {
    const model = this.resolveModel(req.model);
    const url = `${this.config.baseUrl}/chat/completions`;

    const body = { ...req, model };
    const res = await this.postJSON(url, body, ctx);

    if (req.stream) {
      return this.proxyStream(res, ctx);
    }

    const data = await res.json() as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
    const tokens = data.usage?.total_tokens ?? ctx.estimatedTokens ?? 0;
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
