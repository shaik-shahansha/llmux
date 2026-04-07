/**
 * Hugging Face image generation provider.
 * Uses the text-to-image inference API (returns raw binary).
 */

import type { ChatCompletionRequest, ImageGenerationRequest, ImageGenerationResponse } from "../../types/openai.js";
import type { RequestContext } from "../../types/provider.js";
import { BaseProvider } from "../base.js";

export class HuggingFaceImageProvider extends BaseProvider {
  async chatCompletion(_req: ChatCompletionRequest, _ctx: RequestContext): Promise<Response> {
    throw new Error("HuggingFace image provider does not support text completion");
  }

  override async imageGeneration(req: ImageGenerationRequest, ctx: RequestContext): Promise<Response> {
    const modelId = this.resolveModel(req.model ?? "black-forest-labs/FLUX.1-schnell");
    const url = `${this.config.baseUrl}/models/${modelId}`;

    const body = {
      inputs: req.prompt,
      parameters: {},
    };

    const headers = {
      Authorization: `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json",
      Accept: "image/png",
    };

    const res = await this.fetchWithTimeout(
      url,
      { method: "POST", headers, body: JSON.stringify(body) },
      ctx
    );

    if (res.status === 503) {
      // Model is loading
      throw new Error(`HuggingFace model ${modelId} is loading, try again shortly`);
    }
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`HuggingFace image error ${res.status}: ${errBody.slice(0, 200)}`);
    }

    await this.rateLimitTracker.recordSuccess(0);

    const arrayBuffer = await res.arrayBuffer();
    const b64 = Buffer.from(arrayBuffer).toString("base64");

    if (req.response_format === "b64_json") {
      const response: ImageGenerationResponse = {
        created: Math.floor(Date.now() / 1000),
        data: [{ b64_json: b64 }],
      };
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Provider": this.config.id },
      });
    }

    const dataUrl = `data:image/png;base64,${b64}`;
    const response: ImageGenerationResponse = {
      created: Math.floor(Date.now() / 1000),
      data: [{ url: dataUrl }],
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Provider": this.config.id },
    });
  }
}
