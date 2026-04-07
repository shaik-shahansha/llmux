/**
 * Hugging Face video generation provider.
 * Rate-limited free inference API.
 * Models: Wan, CogVideoX, Hunyuan Video.
 */

import type { ChatCompletionRequest } from "../../types/openai.js";
import type { RequestContext } from "../../types/provider.js";
import { BaseProvider } from "../base.js";

export class HuggingFaceVideoProvider extends BaseProvider {
  async chatCompletion(_req: ChatCompletionRequest, _ctx: RequestContext): Promise<Response> {
    throw new Error("HuggingFace video provider does not support text completion");
  }

  async videoGeneration(
    prompt: string,
    model: string,
    ctx: RequestContext
  ): Promise<Response> {
    const modelId = this.resolveModel(model);
    const url = `https://api-inference.huggingface.co/models/${modelId}`;

    const res = await this.fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs: prompt }),
      },
      ctx
    );

    if (res.status === 503) {
      throw new Error(`HuggingFace model ${modelId} is loading`);
    }
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`HuggingFace video error ${res.status}: ${errBody.slice(0, 200)}`);
    }

    await this.rateLimitTracker.recordSuccess(0);

    // Returns raw video bytes
    const arrayBuffer = await res.arrayBuffer();
    const b64 = Buffer.from(arrayBuffer).toString("base64");

    return new Response(
      JSON.stringify({
        created: Math.floor(Date.now() / 1000),
        data: [{ b64_json: b64 }],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Provider": this.config.id },
      }
    );
  }
}
