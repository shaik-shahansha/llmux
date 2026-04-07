/**
 * fal.ai image provider.
 * ~100 free credits on signup. 0.9-1.2s generation (fastest).
 * Models: FLUX.2 Pro/Dev/Max, 1000+ models.
 */

import type { ChatCompletionRequest, ImageGenerationRequest, ImageGenerationResponse } from "../../types/openai.js";
import type { RequestContext } from "../../types/provider.js";
import { BaseProvider } from "../base.js";

interface FalResponse {
  images?: Array<{ url: string; content_type: string }>;
  image?: { url: string; content_type: string };
}

export class FalProvider extends BaseProvider {
  async chatCompletion(_req: ChatCompletionRequest, _ctx: RequestContext): Promise<Response> {
    throw new Error("fal.ai provider does not support text completion");
  }

  override async imageGeneration(req: ImageGenerationRequest, ctx: RequestContext): Promise<Response> {
    const modelId = this.resolveModel(req.model ?? "fal-ai/flux/schnell");
    const url = `${this.config.baseUrl}/${modelId}`;

    const [width, height] = this.parseSize(req.size ?? "1024x1024");

    const body = {
      prompt: req.prompt,
      image_size: { width, height },
      num_images: req.n ?? 1,
      sync_mode: true,  // Wait for result synchronously
    };

    const headers = {
      Authorization: `Key ${this.config.apiKey}`,
      "Content-Type": "application/json",
    };

    const res = await this.fetchWithTimeout(
      url,
      { method: "POST", headers, body: JSON.stringify(body) },
      ctx
    );

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`fal.ai error ${res.status}: ${errBody.slice(0, 200)}`);
    }

    const falData = (await res.json()) as FalResponse;
    const images = falData.images ?? (falData.image ? [falData.image] : []);

    await this.rateLimitTracker.recordSuccess(0);

    const response: ImageGenerationResponse = {
      created: Math.floor(Date.now() / 1000),
      data: images.map((img) => ({ url: img.url })),
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Provider": this.config.id },
    });
  }

  private parseSize(size: string): [number, number] {
    const parts = size.split("x");
    const w = parseInt(parts[0] ?? "1024");
    const h = parseInt(parts[1] ?? "1024");
    return [isNaN(w) ? 1024 : w, isNaN(h) ? 1024 : h];
  }
}
