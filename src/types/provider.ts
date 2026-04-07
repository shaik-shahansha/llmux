/**
 * Internal provider types for LLMux.
 * These are the internal representations used by the router
 * and provider implementations—not exposed to clients.
 */

import type { ChatCompletionRequest, ImageGenerationRequest, AudioSpeechRequest } from "./openai.js";

// ── Modality ──────────────────────────────────────────────────────────────────

export type Modality = "text" | "image" | "stt" | "tts" | "video";

// ── Rate limit tracking ───────────────────────────────────────────────────────

export interface RateLimitState {
  rpm: number;       // requests per minute limit (0 = unlimited)
  rpd: number;       // requests per day limit (0 = unlimited)
  tpm: number;       // tokens per minute limit (0 = unlimited)
  tpd: number;       // tokens per day limit (0 = unlimited)
  // Current window counts
  requestsThisMinute: number;
  requestsToday: number;
  tokensThisMinute: number;
  tokensToday: number;
  // Timestamps
  minuteWindowStart: number;
  dayWindowStart: number;
  // Provider-reported remaining (from response headers)
  remainingRequests?: number;
  remainingTokens?: number;
  resetRequests?: number;   // unix timestamp
  resetTokens?: number;     // unix timestamp
  // Cooldown (after errors)
  cooledUntil?: number;
}

// ── Provider model ────────────────────────────────────────────────────────────

export interface ProviderModel {
  id: string;
  alias?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
}

// ── Provider health ───────────────────────────────────────────────────────────

export type ProviderStatus = "healthy" | "degraded" | "unavailable" | "unknown";

export interface ProviderHealth {
  status: ProviderStatus;
  latencyMs?: number;
  lastChecked?: number;
  lastError?: string;
  consecutiveErrors: number;
}

// ── Provider config (parsed from providers.yaml) ─────────────────────────────

export interface ProviderConfig {
  id: string;
  name: string;
  modality: Modality;
  tier: 1 | 2 | 3 | 4;
  enabled: boolean;
  requiresAuth: boolean;
  apiKey?: string;
  apiKeys?: string[];       // multiple keys — rotated on rate-limit
  accountId?: string;
  baseUrl: string;
  adapter?: "openai" | "gemini" | "cloudflare" | "cohere" | "custom";
  models: ProviderModel[];
  limits: {
    rpm?: number;
    rpd?: number;
    tpm?: number;
    tpd?: number;
    reqIntervalMs?: number;      // for simple rate limiting (e.g. Pollinations)
    neuronsPerDay?: number;      // Cloudflare billing unit
    charsPerMonth?: number;      // ElevenLabs
  };
  healthCheck?: {
    enabled: boolean;
    intervalSeconds: number;
  };
  concurrency?: number;           // max parallel requests
  timeout?: number;               // per-request timeout ms
  maxRetries?: number;
  headers?: Record<string, string>; // extra static headers
}

// ── Request context ───────────────────────────────────────────────────────────

export interface RequestContext {
  requestId: string;
  modality: Modality;
  model: string;              // the model alias the client requested
  estimatedTokens?: number;   // pre-flight estimate
  resolvedTokens?: number;    // actual tokens from provider response (non-streaming)
  stream?: boolean;
  startTime: number;
}

// ── Provider response ─────────────────────────────────────────────────────────

export interface ProviderCallResult<T = unknown> {
  data: T;
  provider: string;
  model: string;
  latencyMs: number;
  tokensUsed?: number;
  promptTokens?: number;
  completionTokens?: number;
}

// ── Router strategy types ─────────────────────────────────────────────────────

export type RouterStrategy =
  | "round-robin"
  | "least-busy"
  | "priority"
  | "latency-based"
  | "random-weighted";

export interface RouterOptions {
  strategy: RouterStrategy;
  fallbackEnabled: boolean;
  maxFallbackAttempts: number;
}

// ── Abstract provider interface ───────────────────────────────────────────────

export interface IProvider {
  readonly config: ProviderConfig;
  readonly health: ProviderHealth;
  readonly rateLimitState: RateLimitState;
  readonly rateLimitTracker: import("../ratelimit/tracker.js").RateLimitTracker;

  /** Check if this provider can handle the request given current rate limits */
  canHandle(ctx: RequestContext): boolean;

  /** Chat completion — returns streaming ReadableStream or JSON response */
  chatCompletion(req: ChatCompletionRequest, ctx: RequestContext): Promise<Response>;

  /** Non-streaming text completion (legacy) */
  textCompletion?(req: { prompt: string; model: string; max_tokens?: number }, ctx: RequestContext): Promise<Response>;

  /** Image generation */
  imageGeneration?(req: ImageGenerationRequest, ctx: RequestContext): Promise<Response>;

  /** Speech-to-text transcription */
  transcription?(formData: FormData, ctx: RequestContext): Promise<Response>;

  /** Text-to-speech synthesis */
  speech?(req: AudioSpeechRequest, ctx: RequestContext): Promise<Response>;

  /** Ping/health-check */
  ping(): Promise<boolean>;
}
