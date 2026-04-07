# LLMux — GitHub Copilot Instructions

## Project Overview
LLMux is a **self-hosted AI gateway** (Hono + TypeScript) that unifies 22+ providers behind a single OpenAI-compatible API. It handles key rotation, rate-limit-aware routing, 3-level fallback, and a live dashboard.

## Technology Stack
- **Runtime**: Node.js 20+, TypeScript 5.6, ESM modules (`"type": "module"`)
- **Framework**: Hono v4.6.3
- **Package manager**: pnpm
- **Tests**: Vitest
- **Build**: `tsc -p tsconfig.json` — must produce exit 0

## Critical TypeScript Rules
- `exactOptionalPropertyTypes: true` — never assign `undefined` to optional fields; omit them entirely
- `strict: true` — all strict checks enabled
- Use `.js` extensions in ESM imports: `import { foo } from "./bar.js"`
- Do not use `require()` — this is ESM only

## Architecture Patterns

### Adding a New Text Provider (OpenAI-compatible API)
If the provider uses OpenAI's API format, **no new class is needed**. Just:
1. Add entry to `config/providers.yaml` with `adapter: openai`
2. Add `"provider-id": OpenAIProvider` to `PROVIDER_FACTORIES` in `src/providers/registry.ts`
3. Add `${PROVIDER_API_KEY}` env var to `.env.example` and `README.md`

### Provider Class Pattern
All providers extend `BaseProvider` (`src/providers/base.ts`):
```typescript
export class MyProvider extends BaseProvider {
  async chatCompletion(req: ChatRequest, ctx: ProviderContext): Promise<Response> {
    const model = this.resolveModel(req.model); // resolves alias → real model ID
    const res = await this.postJSON(`${this.config.baseUrl}/chat/completions`, { ...req, model }, ctx);
    if (req.stream) return this.proxyStream(res, ctx);
    const data = await res.json();
    await this.rateLimitTracker.recordSuccess(data.usage?.total_tokens ?? 0);
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  }
}
```

### Provider Config (`config/providers.yaml`)
```yaml
- id: my-provider          # must match key in PROVIDER_FACTORIES
  name: Human Readable Name
  modality: text           # text | image | audio | video
  tier: 1                  # 1 = priority, 2 = fallback
  enabled: true
  requires_auth: true
  api_key: ${MY_API_KEY}   # env var reference
  base_url: https://api.example.com/v1
  adapter: openai          # openai | gemini | cohere | custom
  models:
    - id: model-name-from-api
      alias: friendly-alias   # what clients pass as model=
      context_window: 131072
  limits:
    rpm: 30
    tpm: 100000
  concurrency: 5
  timeout: 30000
  max_retries: 2
```

### Router Config
The router strategy is set in `config/providers.yaml` under `router.default_strategy`:
- `priority` — Tier 1 first (default, quality-first)
- `round-robin` — even load distribution
- `least-busy` — fewest in-flight requests
- `latency-based` — rolling average fastest
- `random-weighted` — tier-weighted random

## Key Files
| File | Purpose |
|---|---|
| `config/providers.yaml` | All provider/model configuration — source of truth |
| `src/providers/registry.ts` | Maps provider IDs → implementation classes |
| `src/providers/base.ts` | Base class: auth, rate limiting, retry, model resolution |
| `src/router/index.ts` | Request routing and fallback engine |
| `src/ratelimit/tracker.ts` | Per-provider, per-key rate limit tracking |
| `src/api/chat.ts` | `/v1/chat/completions` endpoint handler |
| `dashboard/index.html` | Single-file live dashboard (no build step) |

## Model Freshness (Last verified: April 2026)
See `/memories/repo/llmux-models.md` for the current canonical model list per provider.

Key flagship models:
- **OpenAI**: `gpt-5.4` (1M ctx), `gpt-5.4-mini`, `gpt-5.4-nano`
- **Anthropic**: `claude-opus-4-6` (1M ctx), `claude-sonnet-4-6`, `claude-haiku-4-5`
- **Gemini**: `gemini-3.1-pro-preview` (2M ctx), `gemini-3-flash-preview`, `gemini-2.5-pro` (stable)
- **Groq**: `openai/gpt-oss-120b` (500 tps), `openai/gpt-oss-20b` (1000 tps), `llama-3.3-70b-versatile`
- **NVIDIA NIM**: `nvidia/nemotron-3-super-120b-a12b` (1M ctx), `qwen/qwen3.5-397b-a17b`
- **Kimi**: `kimi-k2.5` (OpenAI-compatible, api.moonshot.cn/v1)
- **GLM**: `glm-5` (OpenAI-compatible, open.bigmodel.cn/api/paas/v4)

## Common Patterns to Avoid
- Do NOT import `node:` modules directly in provider files — use abstractions from `base.ts`
- Do NOT add `console.log` — use `logger` from `src/middleware/logger.ts`
- Do NOT hardcode API keys — always use `${ENV_VAR}` references in yaml
- Do NOT modify `config/providers-dynamic.json` manually — it is written by the Settings UI at runtime
