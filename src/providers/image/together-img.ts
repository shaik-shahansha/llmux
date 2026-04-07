/**
 * Together AI image provider — OpenAI-compatible images endpoint.
 * Free FLUX.1 Schnell endpoint (sub-second generation).
 */

import type { ChatCompletionRequest, ImageGenerationRequest, ImageGenerationResponse } from "../../types/openai.js";
import type { RequestContext } from "../../types/provider.js";
import { BaseProvider } from "../base.js";

export class TogetherImageProvider extends BaseProvider {
  async chatCompletion(_req: ChatCompletionRequest, _ctx: RequestContext): Promise<Response> {
    throw new Error("Together image provider does not support text completion");
  }

  override async imageGeneration(req: ImageGenerationRequest, ctx: RequestContext): Promise<Response> {
    const model = this.resolveModel(req.model ?? "black-forest-labs/FLUX.1-schnell-Free");
    const url = `${this.config.baseUrl}/images/generations`;

    const body = {
      model,
      prompt: req.prompt,
      n: req.n ?? 1,
      size: req.size ?? "1024x1024",
      response_format: req.response_format ?? "url",
    };

    const res = await this.postJSON(url, body, ctx);
    const data = (await res.json()) as ImageGenerationResponse;

    await this.rateLimitTracker.recordSuccess(0);

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Provider": this.config.id },
    });
  }
}
