/**
 * DeepSeek provider — OpenAI-compatible.
 * Free: 5M tokens (30-day expiry) then paid.
 * Models: DeepSeek-V3.2, DeepSeek-R1.
 */

import type { ChatCompletionRequest } from "../../types/openai.js";
import type { RequestContext } from "../../types/provider.js";
import { BaseProvider } from "../base.js";

export class DeepSeekProvider extends BaseProvider {
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
