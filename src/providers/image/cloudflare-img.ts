/**
 * Cloudflare Workers AI image provider.
 * Free tier: 10,000 neurons/day (~20-50 images).
 * Models: FLUX.2 Klein, FLUX.1 Schnell, DreamShaper.
 */

import type { ChatCompletionRequest, ImageGenerationRequest, ImageGenerationResponse } from "../../types/openai.js";
import type { RequestContext } from "../../types/provider.js";
import { BaseProvider } from "../base.js";

export class CloudflareImageProvider extends BaseProvider {
  async chatCompletion(_req: ChatCompletionRequest, _ctx: RequestContext): Promise<Response> {
    throw new Error("Cloudflare image provider does not support text completion");
  }

  override async imageGeneration(req: ImageGenerationRequest, ctx: RequestContext): Promise<Response> {
    const modelId = this.resolveModel(req.model ?? "@cf/black-forest-labs/flux-2-klein-4b");
    const url = `${this.config.baseUrl}/${encodeURIComponent(modelId)}`;

    const [width, height] = this.parseSize(req.size ?? "1024x1024");

    const body = {
      prompt: req.prompt,
      num_steps: 4,  // Schnell/fast models need fewer steps
      width,
      height,
    };

    const headers = {
      Authorization: `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json",
    };

    const res = await this.fetchWithTimeout(
      url,
      { method: "POST", headers, body: JSON.stringify(body) },
      ctx
    );

    if (res.status === 429) {
      await this.rateLimitTracker.recordRateLimitError();
      throw new Error(`Rate limit exceeded for ${this.config.id}`);
    }
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Cloudflare image error ${res.status}: ${errBody.slice(0, 200)}`);
    }

    await this.rateLimitTracker.recordSuccess(0);

    // CF returns raw image bytes
    const arrayBuffer = await res.arrayBuffer();

    if (req.response_format === "b64_json") {
      const b64 = Buffer.from(arrayBuffer).toString("base64");
      const response: ImageGenerationResponse = {
        created: Math.floor(Date.now() / 1000),
        data: [{ b64_json: b64 }],
      };
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Provider": this.config.id },
      });
    }

    // Embed as data URL
    const b64 = Buffer.from(arrayBuffer).toString("base64");
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

  private parseSize(size: string): [number, number] {
    const parts = size.split("x");
    const w = parseInt(parts[0] ?? "1024");
    const h = parseInt(parts[1] ?? "1024");
    return [isNaN(w) ? 1024 : w, isNaN(h) ? 1024 : h];
  }
}
