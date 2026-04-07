/**
 * Provider registry.
 * Discovers all configured providers, instantiates them,
 * and exposes them for the router to query.
 */

import type { IProvider, ProviderConfig, Modality } from "../types/provider.js";
import { loadConfig } from "../config/loader.js";
import { logger } from "../middleware/logger.js";

// Text providers
import { GroqProvider } from "./text/groq.js";
import { CerebrasProvider } from "./text/cerebras.js";
import { GeminiProvider } from "./text/gemini.js";
import { MistralProvider } from "./text/mistral.js";
import { OpenRouterProvider } from "./text/openrouter.js";
import { CloudflareTextProvider } from "./text/cloudflare.js";
import { HuggingFaceTextProvider } from "./text/huggingface.js";
import { SambanovaProvider } from "./text/sambanova.js";
import { CohereProvider } from "./text/cohere.js";
import { DeepSeekProvider } from "./text/deepseek.js";
import { NvidiaProvider } from "./text/nvidia-nim.js";
import { GitHubModelsProvider } from "./text/github-models.js";
import { PollinationsTextProvider } from "./text/pollinations.js";
import { OpenAIProvider } from "./text/openai.js";
import { AnthropicProvider } from "./text/anthropic.js";

// Image providers
import { PollinationsProvider } from "./image/pollinations.js";
import { CloudflareImageProvider } from "./image/cloudflare-img.js";
import { TogetherImageProvider } from "./image/together-img.js";
import { HuggingFaceImageProvider } from "./image/huggingface-img.js";
import { FalProvider } from "./image/fal.js";

// Audio providers
import { GroqWhisperProvider } from "./audio/groq-whisper.js";
import { GroqTTSProvider } from "./audio/groq-tts.js";
import { ElevenLabsProvider } from "./audio/elevenlabs.js";
import { DeepgramProvider } from "./audio/deepgram.js";
import { FishAudioProvider } from "./audio/fish-audio.js";
import { PollinationsAudioProvider } from "./audio/pollinations-audio.js";

// Video providers
import { ReplicateVideoProvider } from "./video/replicate.js";
import { HuggingFaceVideoProvider } from "./video/huggingface-video.js";

type ProviderConstructor = new (cfg: ProviderConfig) => IProvider;

// Map config adapter/id patterns to provider classes
const PROVIDER_FACTORIES: Record<string, ProviderConstructor> = {
  "groq-llama3-70b": GroqProvider,
  "cerebras-llama3": CerebrasProvider,
  "gemini-flash": GeminiProvider,
  "mistral-large": MistralProvider,
  "openrouter-free": OpenRouterProvider,
  "cloudflare-text": CloudflareTextProvider,
  "huggingface-text": HuggingFaceTextProvider,
  "sambanova-text": SambanovaProvider,
  "cohere-text": CohereProvider,
  "deepseek-text": DeepSeekProvider,
  "nvidia-nim": NvidiaProvider,
  "github-models": GitHubModelsProvider,
  "pollinations-text": PollinationsTextProvider,
  "openai": OpenAIProvider,
  "anthropic": AnthropicProvider,
  "kimi": OpenAIProvider,
  "glm": OpenAIProvider,
  "xai-grok": OpenAIProvider,
  "pollinations-image": PollinationsProvider,
  "cloudflare-image": CloudflareImageProvider,
  "together-image": TogetherImageProvider,
  "huggingface-image": HuggingFaceImageProvider,
  "fal-image": FalProvider,
  "groq-whisper": GroqWhisperProvider,
  "groq-tts": GroqTTSProvider,
  "elevenlabs": ElevenLabsProvider,
  "deepgram-tts": DeepgramProvider,
  "deepgram-stt": DeepgramProvider,
  "fish-audio": FishAudioProvider,
  "pollinations-tts": PollinationsAudioProvider,
  "pollinations-stt": PollinationsAudioProvider,
  "replicate-video": ReplicateVideoProvider,
  "huggingface-video": HuggingFaceVideoProvider,
};

class ProviderRegistry {
  private providers: Map<string, IProvider> = new Map();
  private healthTimers: Map<string, ReturnType<typeof setInterval>> = new Map();

  initialize(): void {
    const cfg = loadConfig();
    let loaded = 0;
    let skipped = 0;

    for (const providerCfg of cfg.providers) {
      // Skip providers without API key when auth is required
      if (providerCfg.requiresAuth && !providerCfg.apiKey) {
        logger.debug({ provider: providerCfg.id }, "Skipping provider — no API key configured");
        skipped++;
        continue;
      }

      const Factory = PROVIDER_FACTORIES[providerCfg.id];
      if (!Factory) {
        logger.warn({ provider: providerCfg.id }, "No factory found for provider ID, skipping");
        skipped++;
        continue;
      }

      try {
        const instance = new Factory(providerCfg);
        this.providers.set(providerCfg.id, instance);
        loaded++;

        // Schedule health checks
        if (providerCfg.healthCheck?.enabled) {
          const interval = setInterval(
            () => this.runHealthCheck(providerCfg.id),
            providerCfg.healthCheck.intervalSeconds * 1000
          );
          this.healthTimers.set(providerCfg.id, interval);
        }
      } catch (err) {
        logger.error({ provider: providerCfg.id, err }, "Failed to instantiate provider");
        skipped++;
      }
    }

    logger.info({ loaded, skipped }, "Provider registry initialized");
  }

  private async runHealthCheck(providerId: string): Promise<void> {
    const provider = this.providers.get(providerId);
    if (!provider) return;
    const start = Date.now();
    try {
      const ok = await provider.ping();
      const latencyMs = Date.now() - start;
      const health = provider.health as {
        status: string;
        latencyMs: number;
        lastChecked: number;
        consecutiveErrors: number;
      };
      health.status = ok ? "healthy" : "degraded";
      health.latencyMs = latencyMs;
      health.lastChecked = Date.now();
      if (ok) health.consecutiveErrors = 0;
    } catch (err) {
      const health = provider.health as {
        status: string;
        lastError: string;
        consecutiveErrors: number;
      };
      health.status = "unavailable";
      health.lastError = (err as Error).message;
      health.consecutiveErrors++;
    }
  }

  getAll(): IProvider[] {
    return Array.from(this.providers.values());
  }

  getByModality(modality: Modality): IProvider[] {
    return this.getAll().filter((p) => p.config.modality === modality);
  }

  getById(id: string): IProvider | undefined {
    return this.providers.get(id);
  }

  /** Get all providers that can handle the given model alias */
  getByModel(model: string): IProvider[] {
    return this.getAll().filter((p) =>
      p.config.models.some((m) => m.id === model || m.alias === model)
    );
  }

  shutdown(): void {
    for (const timer of this.healthTimers.values()) {
      clearInterval(timer);
    }
    this.healthTimers.clear();
  }

  /** Re-initialize registry after dynamic config changes (clears + reloads). */
  reinitialize(): void {
    this.shutdown();
    this.providers.clear();
    this.initialize();
  }
}

export const registry = new ProviderRegistry();
