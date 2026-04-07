/**
 * Zod schema for providers.yaml configuration validation.
 */

import { z } from "zod";

const ProviderModelSchema = z.object({
  id: z.string().min(1),
  alias: z.string().optional(),
  context_window: z.number().int().positive().optional(),
  max_output_tokens: z.number().int().positive().optional(),
});

const LimitsSchema = z.object({
  rpm: z.number().int().nonnegative().optional(),
  rpd: z.number().int().nonnegative().optional(),
  tpm: z.number().int().nonnegative().optional(),
  tpd: z.number().int().nonnegative().optional(),
  req_interval_ms: z.number().int().positive().optional(),
  neurons_per_day: z.number().int().positive().optional(),
  chars_per_month: z.number().int().positive().optional(),
}).default({});

const HealthCheckSchema = z.object({
  enabled: z.boolean().default(true),
  interval_seconds: z.number().int().positive().default(60),
});

export const ProviderConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  modality: z.enum(["text", "image", "stt", "tts", "video"]),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(3),
  enabled: z.boolean().default(true),
  requires_auth: z.boolean().default(true),
  api_key: z.string().optional(),
  api_keys: z.array(z.string()).optional(), // multiple keys for round-robin rotation
  account_id: z.string().optional(),
  base_url: z.string().url(),
  adapter: z.enum(["openai", "gemini", "cloudflare", "cohere", "custom"]).default("openai"),
  models: z.array(ProviderModelSchema).min(1),
  limits: LimitsSchema,
  health_check: HealthCheckSchema.optional(),
  concurrency: z.number().int().positive().default(5),
  timeout: z.number().int().positive().default(30000),
  max_retries: z.number().int().nonnegative().default(2),
  headers: z.record(z.string()).optional(),
});

export const ProvidersFileSchema = z.object({
  providers: z.array(ProviderConfigSchema).min(1),
  router: z
    .object({
      default_strategy: z
        .enum(["round-robin", "least-busy", "priority", "latency-based", "random-weighted"])
        .default("priority"),
      fallback_enabled: z.boolean().default(true),
      max_fallback_attempts: z.number().int().positive().default(5),
    })
    .default({}),
  gateway: z
    .object({
      max_request_size_mb: z.number().positive().default(10),
      request_timeout_ms: z.number().int().positive().default(60000),
      enable_request_logging: z.boolean().default(true),
    })
    .default({}),
});

export type ProviderConfigRaw = z.infer<typeof ProviderConfigSchema>;
export type ProvidersFile = z.infer<typeof ProvidersFileSchema>;
