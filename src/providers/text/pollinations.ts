/**
 * Pollinations AI text provider — OpenAI-compatible endpoint.
 * Base URL: https://gen.pollinations.ai
 * Docs: https://github.com/pollinations/pollinations/blob/main/APIDOCS.md
 *
 * Full OpenAI Chat Completions API compatibility.
 * Supports streaming, function calling, vision, structured outputs, reasoning modes.
 * Models include: openai (GPT-4o), claude, gemini, mistral, llama, deepseek-r1, grok, etc.
 */

import type { ChatCompletionRequest } from "../../types/openai.js";
import type { RequestContext } from "../../types/provider.js";
import { BaseProvider } from "../base.js";

export class PollinationsTextProvider extends BaseProvider {
  async chatCompletion(req: ChatCompletionRequest, ctx: RequestContext): Promise<Response> {
    const model = this.resolveModel(req.model);
    const url = `${this.config.baseUrl}/v1/chat/completions`;

    const body = { ...req, model };
    const res = await this.postJSON(url, body, ctx);

    if (req.stream) {
      return this.proxyStream(res, ctx);
    }

    const data = await res.json();
    const tokens =
      (data as { usage?: { total_tokens?: number } }).usage?.total_tokens ??
      ctx.estimatedTokens ??
      0;
    await this.recordTokens(ctx, tokens);

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Provider": this.config.id },
    });
  }

  override async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.baseUrl}/v1/models`, {
        headers: this.getCurrentApiKey()
          ? { Authorization: `Bearer ${this.getCurrentApiKey()}` }
          : {},
        signal: AbortSignal.timeout(8000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
