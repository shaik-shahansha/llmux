/**
 * Abstract base class for all LLMux providers.
 * Handles common concerns: auth headers, fetch with timeout,
 * rate-limit tracking, and SSE stream proxying.
 */

import type {
  IProvider,
  ProviderConfig,
  ProviderHealth,
  RateLimitState,
  RequestContext,
} from "../types/provider.js";
import type { ChatCompletionRequest, ImageGenerationRequest, AudioSpeechRequest } from "../types/openai.js";
import { RateLimitTracker } from "../ratelimit/tracker.js";
import { parseRateLimitHeaders } from "../ratelimit/headers.js";
import { requestLog } from "../ratelimit/requestlog.js";
import { logger } from "../middleware/logger.js";

export abstract class BaseProvider implements IProvider {
  readonly config: ProviderConfig;
  readonly health: ProviderHealth;
  readonly rateLimitTracker: RateLimitTracker;
  private _keyIndex = 0;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.health = {
      status: "unknown",
      consecutiveErrors: 0,
    };
    this.rateLimitTracker = new RateLimitTracker(config);
  }

  get rateLimitState(): RateLimitState {
    // Synchronous approximation — callers should use tracker.getState() for accuracy
    return {
      rpm: this.config.limits.rpm ?? 0,
      rpd: this.config.limits.rpd ?? 0,
      tpm: this.config.limits.tpm ?? 0,
      tpd: this.config.limits.tpd ?? 0,
      requestsThisMinute: 0,
      requestsToday: 0,
      tokensThisMinute: 0,
      tokensToday: 0,
      minuteWindowStart: Date.now(),
      dayWindowStart: Date.now(),
    };
  }

  canHandle(ctx: RequestContext): boolean {
    if (this.config.modality !== ctx.modality) return false;
    if (this.health.status === "unavailable") return false;
    if (this.health.cooledUntil && Date.now() < this.health.cooledUntil) return false;
    // Model check — provider must support the requested model
    const supportsModel = this.config.models.some(
      (m) => m.id === ctx.model || m.alias === ctx.model
    );
    return supportsModel || ctx.model === "auto";
  }

  /** Get the current API key, rotating through the pool if multiple are configured. */
  protected getCurrentApiKey(): string | undefined {
    if (this.config.apiKeys && this.config.apiKeys.length > 0) {
      return this.config.apiKeys[this._keyIndex % this.config.apiKeys.length];
    }
    return this.config.apiKey;
  }

  /** Rotate to the next API key in the pool (called after 429). */
  protected rotateApiKey(): void {
    if (this.config.apiKeys && this.config.apiKeys.length > 1) {
      this._keyIndex = (this._keyIndex + 1) % this.config.apiKeys.length;
      logger.debug(
        { provider: this.config.id, keyIndex: this._keyIndex, totalKeys: this.config.apiKeys.length },
        "Rotated to next API key"
      );
    }
  }

  /** Build standard auth + content-type headers. */
  protected buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.config.headers,
      ...extra,
    };
    const key = this.getCurrentApiKey();
    if (key) {
      headers["Authorization"] = `Bearer ${key}`;
    }
    return headers;
  }

  /** Fetch with timeout + automatic rate-limit header parsing. */
  protected async fetchWithTimeout(
    url: string,
    init: RequestInit,
    ctx: RequestContext
  ): Promise<Response> {
    const timeoutMs = this.config.timeout ?? 30_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });

      // Parse and apply rate-limit headers asynchronously (don't block response)
      const headerUpdate = parseRateLimitHeaders(res.headers);
      if (Object.keys(headerUpdate).length > 0) {
        void this.rateLimitTracker.applyHeaderUpdates(headerUpdate);
      }

      return res;
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") {
        throw new Error(`Provider ${this.config.id} timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Make a JSON POST request and handle common error scenarios.
   * Records rate-limit tracking on success/failure.
   */
  protected async postJSON(
    url: string,
    body: unknown,
    ctx: RequestContext,
    extraHeaders: Record<string, string> = {}
  ): Promise<Response> {
    const headers = this.buildHeaders(extraHeaders);
    const res = await this.fetchWithTimeout(
      url,
      { method: "POST", headers, body: JSON.stringify(body) },
      ctx
    );

    if (res.status === 429) {
      await this.rateLimitTracker.recordRateLimitError();
      (this.health as { consecutiveErrors: number }).consecutiveErrors++;
      this.rotateApiKey(); // try next key in pool on rate-limit
      throw new RateLimitError(this.config.id, res);
    }

    if (!res.ok) {
      (this.health as { consecutiveErrors: number }).consecutiveErrors++;
      await this.rateLimitTracker.recordError(this.health.consecutiveErrors);
      throw new ProviderError(this.config.id, res.status, await res.text());
    }

    (this.health as { consecutiveErrors: number; status: string }).consecutiveErrors = 0;
    (this.health as { status: string }).status = "healthy";

    return res;
  }

  /**
   * Pass through a streaming SSE response from an upstream provider
   * to the client, recording token usage when the stream ends.
   */
  protected async proxyStream(
    upstreamRes: Response,
    ctx: RequestContext
  ): Promise<Response> {
    const upstream = upstreamRes.body;
    if (!upstream) throw new Error("Empty response body from provider");

    let totalTokens = 0;

    const transformed = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        // Parse SSE chunks to extract usage data
        const text = new TextDecoder().decode(chunk);
        const lines = text.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            try {
              const data = JSON.parse(line.slice(6));
              if (data?.usage?.total_tokens) {
                totalTokens = data.usage.total_tokens as number;
              }
            } catch {
              // ignore parse errors in stream
            }
          }
        }
        controller.enqueue(chunk);
      },
      flush: () => {
        // Record usage after stream ends
        const tokens = totalTokens || ctx.estimatedTokens || 0;
        void this.rateLimitTracker.recordSuccess(tokens);
        requestLog.updateTokens(ctx.requestId, tokens);
      },
    });

    const stream = upstream.pipeThrough(transformed);

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Provider": this.config.id,
      },
    });
  }

  /**
   * Resolve a model alias to its canonical provider model ID.
   */
  protected resolveModel(modelAlias: string): string {
    const found = this.config.models.find(
      (m) => m.id === modelAlias || m.alias === modelAlias
    );
    return found?.id ?? this.config.models[0]?.id ?? modelAlias;
  }

  /**
   * Record actual token usage for both rate-limit tracking and the request log.
   * For non-streaming responses, also stores the token count on `ctx.resolvedTokens`
   * so that `fallback.ts` can write the correct value into the log entry.
   * For streaming responses, the log entry is patched later via `requestLog.updateTokens()`
   * in the `proxyStream` flush callback.
   */
  protected async recordTokens(ctx: RequestContext, tokens: number): Promise<void> {
    await this.rateLimitTracker.recordSuccess(tokens);
    // Store on ctx so fallback.ts can use it when calling requestLog.record()
    ctx.resolvedTokens = tokens;
  }

  // Abstract methods — subclasses must implement at least chatCompletion
  abstract chatCompletion(req: ChatCompletionRequest, ctx: RequestContext): Promise<Response>;

  imageGeneration?(req: ImageGenerationRequest, ctx: RequestContext): Promise<Response>;
  transcription?(formData: FormData, ctx: RequestContext): Promise<Response>;
  speech?(req: AudioSpeechRequest, ctx: RequestContext): Promise<Response>;

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(this.config.baseUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });
      return res.status < 500;
    } catch {
      return false;
    }
  }
}

// ── Custom error types ────────────────────────────────────────────────────────

export class RateLimitError extends Error {
  readonly providerId: string;
  readonly response: Response;
  constructor(providerId: string, response: Response) {
    super(`Rate limit exceeded for provider ${providerId}`);
    this.name = "RateLimitError";
    this.providerId = providerId;
    this.response = response;
  }
}

export class ProviderError extends Error {
  readonly providerId: string;
  readonly statusCode: number;
  readonly body: string;
  constructor(providerId: string, statusCode: number, body: string) {
    super(`Provider ${providerId} returned ${statusCode}: ${body.slice(0, 200)}`);
    this.name = "ProviderError";
    this.providerId = providerId;
    this.statusCode = statusCode;
    this.body = body;
  }
}

// Add cooledUntil to ProviderHealth type (extends internal health object)
declare module "../types/provider.js" {
  interface ProviderHealth {
    cooledUntil?: number;
  }
}
