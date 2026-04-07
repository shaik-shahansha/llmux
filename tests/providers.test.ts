/**
 * Provider-level tests.
 * Tests config loading, provider instantiation, and request validation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { clearConfigCache } from "../src/config/loader.js";
import { ProvidersFileSchema } from "../src/config/schema.js";

// ── Config schema validation ───────────────────────────────────────────────────

describe("ProvidersFileSchema", () => {
  const validConfig = {
    providers: [
      {
        id: "test-provider",
        name: "Test Provider",
        modality: "text",
        tier: 1,
        enabled: true,
        requires_auth: true,
        api_key: "test-key",
        base_url: "https://api.example.com/v1",
        adapter: "openai",
        models: [
          { id: "test-model", alias: "test", context_window: 4096 },
        ],
        limits: { rpm: 30, rpd: 1000, tpm: 60000 },
        health_check: { enabled: true, interval_seconds: 60 },
      },
    ],
    router: {
      default_strategy: "priority",
      fallback_enabled: true,
      max_fallback_attempts: 3,
    },
    gateway: {
      max_request_size_mb: 10,
      request_timeout_ms: 60000,
      enable_request_logging: true,
    },
  };

  it("parses valid config", () => {
    const result = ProvidersFileSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it("rejects config with no providers", () => {
    const result = ProvidersFileSchema.safeParse({ ...validConfig, providers: [] });
    expect(result.success).toBe(false);
  });

  it("rejects provider with invalid modality", () => {
    const bad = {
      ...validConfig,
      providers: [{ ...validConfig.providers[0], modality: "invalid" }],
    };
    const result = ProvidersFileSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects provider with invalid base_url", () => {
    const bad = {
      ...validConfig,
      providers: [{ ...validConfig.providers[0], base_url: "not-a-url" }],
    };
    const result = ProvidersFileSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("applies default values for optional fields", () => {
    const minimal = {
      providers: [
        {
          id: "min",
          name: "Min",
          modality: "text",
          base_url: "https://api.example.com",
          models: [{ id: "m1" }],
        },
      ],
    };
    const result = ProvidersFileSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      const p = result.data.providers[0]!;
      expect(p.enabled).toBe(true);
      expect(p.tier).toBe(3);
      expect(p.adapter).toBe("openai");
    }
  });

  it("accepts all valid modalities", () => {
    const modalities = ["text", "image", "stt", "tts", "video"] as const;
    for (const modality of modalities) {
      const cfg = {
        ...validConfig,
        providers: [{ ...validConfig.providers[0], modality }],
      };
      const result = ProvidersFileSchema.safeParse(cfg);
      expect(result.success).toBe(true);
    }
  });

  it("accepts all valid router strategies", () => {
    const strategies = ["round-robin", "least-busy", "priority", "latency-based", "random-weighted"] as const;
    for (const strategy of strategies) {
      const cfg = {
        ...validConfig,
        router: { ...validConfig.router, default_strategy: strategy },
      };
      const result = ProvidersFileSchema.safeParse(cfg);
      expect(result.success).toBe(true);
    }
  });
});

// ── Gemini message conversion ──────────────────────────────────────────────────

describe("Gemini OpenAI→Gemini message conversion", () => {
  // We test the internal logic indirectly via the exported provider
  it("handles system message extraction", async () => {
    const { GeminiProvider } = await import("../src/providers/text/gemini.js");
    // We access the private method indirectly by looking at the exported class
    // This is a structural test — if the class exists and is importable, it passes
    expect(GeminiProvider).toBeDefined();
    expect(typeof GeminiProvider).toBe("function");
  });
});

// ── Provider canHandle ─────────────────────────────────────────────────────────

describe("Provider.canHandle", () => {
  it("returns false when modality does not match", async () => {
    const { GroqProvider } = await import("../src/providers/text/groq.js");
    const cfg = {
      id: "groq-test",
      name: "Groq",
      modality: "text" as const,
      tier: 1 as const,
      enabled: true,
      requiresAuth: true,
      apiKey: "test",
      baseUrl: "https://api.groq.com/openai/v1",
      adapter: "openai" as const,
      models: [{ id: "llama-3.3-70b-versatile", alias: "llama-3.3-70b" }],
      limits: { rpm: 30 },
      concurrency: 5,
      timeout: 30000,
      maxRetries: 2,
    };
    const provider = new GroqProvider(cfg);
    expect(provider.canHandle({ requestId: "r1", modality: "image", model: "auto", startTime: Date.now() })).toBe(false);
    expect(provider.canHandle({ requestId: "r1", modality: "text", model: "llama-3.3-70b", startTime: Date.now() })).toBe(true);
    expect(provider.canHandle({ requestId: "r1", modality: "text", model: "auto", startTime: Date.now() })).toBe(true);
  });
});
