/**
 * Replicate video provider.
 * Limited free runs, then pay-per-second.
 * Models: Wan 2.1-2.7, Hailuo, PixVerse.
 * Note: Replicate uses a polling model for long-running tasks.
 */

import type { ChatCompletionRequest } from "../../types/openai.js";
import type { RequestContext } from "../../types/provider.js";
import { BaseProvider } from "../base.js";

interface ReplicatePrediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: string | string[];
  error?: string;
  urls?: { get: string; cancel: string };
}

export class ReplicateVideoProvider extends BaseProvider {
  async chatCompletion(_req: ChatCompletionRequest, _ctx: RequestContext): Promise<Response> {
    throw new Error("Replicate is video generation only");
  }

  /**
   * Generate a video using Replicate's async prediction API.
   * We poll until the prediction completes or times out.
   */
  async videoGeneration(
    prompt: string,
    model: string,
    ctx: RequestContext
  ): Promise<Response> {
    const modelId = this.resolveModel(model);
    const createUrl = `https://api.replicate.com/v1/models/${modelId}/predictions`;

    // Create prediction
    const createRes = await this.fetchWithTimeout(
      createUrl,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: { prompt } }),
      },
      ctx
    );

    if (!createRes.ok) {
      const errBody = await createRes.text();
      throw new Error(`Replicate create error ${createRes.status}: ${errBody.slice(0, 200)}`);
    }

    let prediction = (await createRes.json()) as ReplicatePrediction;

    // Poll until done (max 5 minutes)
    const maxWaitMs = 300_000;
    const startTime = Date.now();

    while (
      prediction.status === "starting" ||
      prediction.status === "processing"
    ) {
      if (Date.now() - startTime > maxWaitMs) {
        throw new Error(`Replicate prediction timed out after 5 minutes`);
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const pollRes = await fetch(prediction.urls?.get ?? `https://api.replicate.com/v1/predictions/${prediction.id}`, {
        headers: { Authorization: `Token ${this.config.apiKey}` },
      });
      prediction = (await pollRes.json()) as ReplicatePrediction;
    }

    if (prediction.status !== "succeeded") {
      throw new Error(`Replicate prediction failed: ${prediction.error ?? "unknown error"}`);
    }

    await this.rateLimitTracker.recordSuccess(0);

    const videoUrl = Array.isArray(prediction.output)
      ? prediction.output[0]
      : prediction.output;

    return new Response(
      JSON.stringify({ created: Math.floor(Date.now() / 1000), data: [{ url: videoUrl }] }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Provider": this.config.id },
      }
    );
  }
}
