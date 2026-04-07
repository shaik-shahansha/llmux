/**
 * Pollinations AI image provider — unified gen.pollinations.ai endpoint.
 * Docs: https://github.com/pollinations/pollinations/blob/main/APIDOCS.md
 *
 * Uses the OpenAI-compatible POST /v1/images/generations endpoint.
 * Supports API key for authenticated (higher tier) usage.
 * Anonymous usage is rate-limited; authenticated usage unlocks more models.
 *
 * Latest models (2026): zimage (default), flux, seedream, seedream5, gptimage,
 *   gptimage-large, wan-image, wan-image-pro, kontext, klein, nova-canvas, etc.
 */

import type { ChatCompletionRequest, ImageGenerationRequest, ImageGenerationResponse } from "../../types/openai.js";
import type { RequestContext } from "../../types/provider.js";
import { BaseProvider } from "../base.js";

export class PollinationsProvider extends BaseProvider {
  // Not a text provider — required by abstract class but unused
  async chatCompletion(_req: ChatCompletionRequest, _ctx: RequestContext): Promise<Response> {
    throw new Error("PollinationsProvider (image) does not support text completion");
  }

  override async imageGeneration(req: ImageGenerationRequest, ctx: RequestContext): Promise<Response> {
    const model = req.model ? this.resolveModel(req.model) : "zimage";
    const url = `${this.config.baseUrl}/v1/images/generations`;

    const body: Record<string, unknown> = {
      prompt: req.prompt,
      model,
      n: 1,
      size: req.size ?? "1024x1024",
      response_format: req.response_format ?? "b64_json",
    };

    // Add seed for reproducibility when provided
    const seed = Math.floor(Math.random() * 2 ** 31);
    body["seed"] = seed;

    const apiKey = this.getCurrentApiKey();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const res = await this.fetchWithTimeout(
      url,
      { method: "POST", headers, body: JSON.stringify(body) },
      ctx
    );

    if (res.status === 429) {
      await this.rateLimitTracker.recordRateLimitError();
      (this.health as { consecutiveErrors: number }).consecutiveErrors++;
      this.rotateApiKey();
      throw new Error(`Pollinations image rate limited`);
    }

    if (!res.ok) {
      (this.health as { consecutiveErrors: number }).consecutiveErrors++;
      throw new Error(`Pollinations image error ${res.status}: ${await res.text()}`);
    }

    (this.health as { consecutiveErrors: number; status: string }).consecutiveErrors = 0;
    (this.health as { status: string }).status = "healthy";
    await this.rateLimitTracker.recordSuccess(0);

    const data = await res.json() as ImageGenerationResponse;
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Provider": this.config.id },
    });
  }

  override async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.baseUrl}/image/models`, {
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
