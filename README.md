<h1>⚡ LLMux</h1>

<p><strong>Multiplex every LLM. Never hit a limit.</strong></p>

<p>
  <a href="https://github.com/your-org/llmux/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/TypeScript-5.6-blue.svg" />
  <img src="https://img.shields.io/badge/OpenAI%20compatible-✓-purple.svg" />
  <img src="https://img.shields.io/badge/self--hosted-✓-orange.svg" />
  <img src="https://img.shields.io/badge/free%20tier%20first-✓-brightgreen.svg" />
</p>

LLMux is a **self-hosted AI gateway** that unifies 20+ free-tier providers behind a single OpenAI-compatible API. It automatically *rotates API keys*, *tracks rate limits*, *falls back across providers*, and gives you a **live operational dashboard** — all with zero cloud dependency and zero per-token cost.

```python
# Before: locked to one provider
client = OpenAI(api_key="sk-...")

# After: one line change, 20+ providers, auto-rotation, never goes down
client = OpenAI(api_key="any", base_url="http://localhost:3000/v1")
```

---

## Why LLMux?

| Problem | LLMux Solution |
|---|---|
| One provider's free tier runs out | Automatic fallback to next best provider |
| Hit 30 RPM on Groq with 3 accounts | `api_keys: [key1, key2, key3]` → 90 effective RPM |
| App breaks on 429 errors | Auto-rotate key → retry → fallback, all transparent |
| No visibility into what's happening | Live dashboard: requests, health, rate limits, latency |
| Locked to OpenAI's format | OpenAI-compatible — zero client-code changes |
| Complex gateway infra needed | Zero DB, runs on a single Node.js instance |

---

## How LLMux is Different

### vs OpenRouter
OpenRouter is a **hosted cloud service** that proxies your traffic through their servers. You pay per token (markup), can't self-host, and your keys never leave their platform. LLMux runs **on your hardware**, rotates *your own* keys, and costs $0/month on free tiers.

### vs LiteLLM
LiteLLM is excellent but Python-only, requires PostgreSQL + Redis for the full dashboard, and does **not** do per-provider multi-key rotation on 429. LLMux is TypeScript, runs with zero database, and has automatic key rotation built into every provider.

### vs Portkey Gateway
Portkey needs their hosted service for full features (observability, load balancing). The open-source version has no multi-key rotation or budget-aware routing. LLMux is 100% self-contained.

---

## Comparison Table

| Feature | LLMux | OpenRouter | LiteLLM | Portkey OSS |
|---|:---:|:---:|:---:|:---:|
| Self-hosted (no cloud dependency) | ✅ | ❌ cloud-only | ✅ | ⚠ limited |
| OpenAI-compatible API | ✅ | ✅ | ✅ | ✅ |
| Free-tier providers (20+) | ✅ | ⚠ some | ✅ | ✅ |
| **Per-key rotation on 429** | ✅ | ❌ | ❌ | ❌ |
| **Rate-limit-aware routing** | ✅ | ❌ | ⚠ partial | ❌ |
| **Multi-key pool per provider** | ✅ | ❌ | ❌ | ❌ |
| Automatic 3-level fallback | ✅ | ⚠ basic | ✅ | ✅ |
| 5 routing strategies | ✅ | ❌ | ✅ | ⚠ |
| Live operational dashboard | ✅ | ✅ hosted | ✅ paid | ⚠ basic |
| Request log (last 500) | ✅ | ❌ self-host | ✅ paid | ❌ |
| Zero database required | ✅ | N/A | ❌ needs Postgres | ✅ |
| TypeScript / Node.js | ✅ | N/A | ❌ Python only | ✅ |
| Text + Image + Audio + Video | ✅ | ✅ | ✅ | ✅ |
| Streaming (SSE) | ✅ | ✅ | ✅ | ✅ |
| Cost to use free tier | $0 | $0 + markup | $0 | $0 |

---

## Quick Start

```bash
git clone https://github.com/your-org/llmux
cd llmux
pnpm install
cp config/providers.yaml.example config/providers.yaml
# Add your API keys to .env
pnpm dev
```

Your gateway is live at `http://localhost:3000`.
Dashboard at `http://localhost:3000/dashboard`.

---

## Providers (22+)

> Last updated: April 2026 — models verified against each provider's official documentation.

### Text / Chat

| Provider | Best Models | Free Tier |
|---|---|---|
| **Groq** | GPT-OSS 120B, GPT-OSS 20B, Llama 3.3 70B, Llama 4 Scout | 30 RPM / 14.4K RPD |
| **Cerebras** | Llama 3.3 70B, Qwen3-32B | 30 RPM, 1M TPD |
| **Google Gemini** | Gemini 3.1 Pro Preview, Gemini 3 Flash, 2.5 Pro (1M–2M ctx) | 15 RPM / 1K RPD |
| **Mistral AI** | Mistral Large, Mistral Small 4 (256K), Magistral Medium, Codestral | ~2 RPM |
| **OpenRouter** | DeepSeek R1, DeepSeek V3, Gemini 2.5 Flash, Qwen3 Coder 480B | 20 RPM / 50 RPD |
| **Cloudflare Workers AI** | Llama 3.3 70B, Llama 4 Scout | 10K neurons/day |
| **Hugging Face** | Llama 4 Scout, Llama 3.3 70B, Qwen3-235B | daily limit |
| **SambaNova** | Llama 4 Maverick, Llama 4 Scout, DeepSeek R1/V3 | 20 RPM |
| **Cohere** | Command A (256K), Command A Reasoning, Command A Vision | 1K calls/month |
| **DeepSeek** | DeepSeek V3, R1 131K | 5M free tokens |
| **NVIDIA NIM** | Nemotron 3 Super 120B (1M ctx), Qwen3.5 397B, Mistral Small 4 | Free Endpoints |
| **GitHub Models** | GPT-5.4, Claude Sonnet 4.6, Llama 4 Scout, DeepSeek R1 | 15 RPM / 150 RPD |
| **Pollinations AI** | openai (GPT-5 Mini), openai-fast (GPT-5 Nano), claude-fast (Claude Haiku 4.5), deepseek (V3.2), mistral, qwen-coder (30B), gemini-fast, kimi, glm, minimax, perplexity, grok, nova + 30 more | Free tier + API key ([enter.pollinations.ai](https://enter.pollinations.ai/)) |
| **xAI Grok** | Grok-3, Grok-3-Mini, Grok-3-Fast, Grok-3-Mini-Fast (131K ctx) | Paid — credits at [console.x.ai](https://console.x.ai/) |
| **Moonshot AI (Kimi)** | Kimi K2.5 (multimodal 1T MoE), Kimi K2 Thinking | Free credits on signup |
| **Zhipu AI (GLM)** | GLM-5 (744B MoE), GLM-4-Flash (free tier) | Free tier available |

### Image

| Provider | Models | Free Tier |
|---|---|---|
| Pollinations AI | flux (Schnell), zimage (Z-Image Turbo), gptimage (GPT Image 1 Mini), klein (FLUX.2 Klein), wan-image (Wan 2.7), qwen-image + seedream5, gptimage-large, kontext (paid) | flux/zimage/klein/wan-image free |
| Cloudflare Workers AI | FLUX.2 Klein, Flux Schnell | 10K neurons/day |
| Together AI | FLUX.1 Schnell Free | Free endpoint |
| Hugging Face | FLUX.1 Schnell, SDXL | Rate-limited |
| fal.ai | FLUX Pro 1.1, Schnell | ~100 credits |

### Video

| Provider | Models | Notes |
|---|---|---|
| Pollinations AI | ltx-2 (LTX-2.3, free), veo (Google Veo 3.1 Fast), wan (Wan 2.6), wan-fast (Wan 2.2), seedance, seedance-pro, grok-video-pro, nova-reel | Native `GET /video/{prompt}` endpoint; ltx-2 free |

### Audio (TTS + STT)

| Provider | Mode | Models |
|---|---|---|
| Groq Whisper | STT | whisper-large-v3-turbo, distil-whisper-en |
| Groq PlayAI | TTS | PlayAI Dialog, Arabic |
| ElevenLabs | TTS | Flash v2.5, Multilingual v2 |
| Deepgram | TTS + STT | Aura-2, Nova-3 |
| Fish Audio | TTS | Speech 1.6 |
| Pollinations AI | TTS + STT + Music | ElevenLabs v3 TTS (30+ voices), Whisper Large V3 (STT), ElevenLabs Scribe v2 (STT, 90+ langs, diarization), ACE-Step music generation |

---

## Pollinations AI — Native API Methods

Pollinations exposes unique **native REST endpoints** in addition to the standard OpenAI-compatible `/v1/chat/completions` path. These are particularly useful for quick prototyping — no SDK needed.

**Base URL:** `https://gen.pollinations.ai`

| Method | Endpoint | Returns | Auth |
|---|---|---|---|
| POST | `/v1/chat/completions` | JSON (OpenAI-compatible, streaming ✓) | Required |
| GET | `/text/{prompt}` | Plain text | Required |
| GET | `/image/{prompt}` | JPEG / PNG | Required |
| GET | `/video/{prompt}` | MP4 | Required |
| GET | `/audio/{text}` | MP3 (TTS or music) | Required |
| POST | `/v1/audio/transcriptions` | JSON | Required |
| GET | `/v1/models` | JSON model list | Open |
| GET | `/text/models` | JSON — per-model capabilities | Open |
| GET | `/image/models` | JSON — image + video models | Open |
| GET | `/audio/models` | JSON — audio models | Open |

**Authentication:** API key from [enter.pollinations.ai](https://enter.pollinations.ai/). Two key types — secret (`sk_`) for server-side, publishable (`pk_`) for client-side (beta, 1 pollen/IP/hr limit).

```bash
# Image — paste directly in browser, no code needed
https://gen.pollinations.ai/image/a%20cat%20in%20space

# Image with params
curl "https://gen.pollinations.ai/image/futuristic%20city?model=flux&width=1280&height=720" \
  -H "Authorization: Bearer YOUR_API_KEY" -o city.jpg

# Video generation
curl "https://gen.pollinations.ai/video/a%20rocket%20launch?model=ltx-2" \
  -H "Authorization: Bearer YOUR_API_KEY" -o rocket.mp4

# Quick text (plain response)
curl "https://gen.pollinations.ai/text/What%20is%20RLHF?model=openai" \
  -H "Authorization: Bearer YOUR_API_KEY"

# TTS with voice selection
curl "https://gen.pollinations.ai/audio/Welcome%20to%20LLMux?model=elevenlabs&voice=nova" \
  -H "Authorization: Bearer YOUR_API_KEY" -o speech.mp3

# Music generation
curl "https://gen.pollinations.ai/audio/upbeat%20jazz%20piano?model=acestep" \
  -H "Authorization: Bearer YOUR_API_KEY" -o music.mp3

# STT transcription
curl -X POST https://gen.pollinations.ai/v1/audio/transcriptions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -F file=@audio.mp3 -F model=scribe
```

**Free vs paid models:** Free models include `openai` (GPT-5 Mini), `openai-fast` (GPT-5 Nano), `claude-fast` (Claude Haiku 4.5), `deepseek` (V3.2), `mistral` (Small 3.2), `qwen-coder` (30B), `gemini-fast` (2.5 Flash Lite), `kimi` (K2.5), `glm` (GLM-5), `minimax` (M2.5), `perplexity-fast`, `nova-fast` for text; `flux`, `zimage`, `klein`, `wan-image`, `qwen-image`, `gptimage` for images; `ltx-2` for video; `elevenlabs` TTS, `whisper`, `scribe` for audio. Paid models (`claude`, `openai-large`, `gemini`, `grok`, etc.) require a pollen balance.

---

## Multi-Key Rotation

The killer feature: add multiple API keys per provider. LLMux round-robins requests and instantly rotates to the next key on HTTP 429.

```yaml
# providers.yaml — triple your effective rate limit:
- id: groq-llama3-70b
  api_keys:
    - ${GROQ_KEY_1}   # 30 RPM each
    - ${GROQ_KEY_2}   # = 90 effective RPM
    - ${GROQ_KEY_3}
```

```
.env
GROQ_KEY_1=gsk_...
GROQ_KEY_2=gsk_...
GROQ_KEY_3=gsk_...
```

---

## Usage Examples

### Python
```python
from openai import OpenAI

client = OpenAI(api_key="any", base_url="http://localhost:3000/v1")

# Text — picks best available provider automatically
response = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "Explain RLHF in one paragraph"}],
)
print(response.choices[0].message.content)

# Streaming
stream = client.chat.completions.create(
    model="gemini-flash",
    messages=[{"role": "user", "content": "Write a poem"}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)

# Image generation
img = client.images.generate(
    prompt="a futuristic city skyline, neon lights, photorealistic",
    model="pollinations-zimage",
)
print(img.data[0].url)

# Text to speech
audio = client.audio.speech.create(
    model="tts-1",
    input="Welcome to LLMux",
    voice="nova",
)
audio.stream_to_file("welcome.mp3")

# Speech to text
with open("audio.mp3", "rb") as f:
    transcript = client.audio.transcriptions.create(
        model="whisper-large-v3-turbo",
        file=f,
    )
print(transcript.text)
```

### TypeScript
```typescript
import OpenAI from "openai";

const client = new OpenAI({ apiKey: "any", baseURL: "http://localhost:3000/v1" });

const { choices } = await client.chat.completions.create({
  model: "deepseek-r1",
  messages: [{ role: "user", content: "Solve x² + 5x + 6 = 0" }],
});
console.log(choices[0].message.content);
```

### curl
```bash
# Chat completion
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"llama-3.3-70b","messages":[{"role":"user","content":"Hello!"}]}'

# Image generation
curl http://localhost:3000/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{"prompt":"a robot painting a canvas","model":"flux"}'

# Provider health + rate-limit state
curl http://localhost:3000/api/stats | jq '.providers[].status'
```

---

## Routing Strategies

Set in `config/providers.yaml` under `router.default_strategy`:

| Strategy | Description | Best For |
|---|---|---|
| `priority` | Tier 1 first, then Tier 2 | Default — quality-first |
| `round-robin` | Cycle through all providers evenly | Even load distribution |
| `least-busy` | Fewest in-flight requests | High-concurrency |
| `latency-based` | Rolling average fastest provider | Latency-sensitive apps |
| `random-weighted` | Tier-weighted random selection | A/B testing |

---

## Provider Tiers

Tiers control **routing priority** — nothing else. They have no relation to cost; you can put a completely free provider at Tier 1.

| Tier | Label | Description | Default for |
|---|---|---|---|
| **1** | High Priority | Tried first on every request. Use your fastest/most reliable providers here. | Groq, Gemini, Cerebras |
| **2** | Standard | Tried after Tier 1 is rate-limited or unavailable. Good for secondary free providers. | New providers (default) |
| **3** | Fallback | Used when tiers 1–2 are all busy or failing. | Slower/unlimited providers |
| **4** | Last Resort | Emergency fallback only — rarely reached in practice. | Experimental providers |

In `priority` strategy mode, LLMux always starts from Tier 1 and works down. In `round-robin`, `least-busy`, and `latency-based` modes, tier is still used to break ties.

Configure via `tier:` in `config/providers.yaml`:

```yaml
- id: groq-llama3-70b
  tier: 1          # tried first — fastest free provider
  ...

- id: huggingface-text
  tier: 2          # fallback — slower but no rate limit issues
  ...
```

Or change it per-provider in the **Settings → Providers** dashboard.

---

## Dashboard

The live operational dashboard at `/dashboard` shows:

- **Provider Health Matrix** — status dot, modality, RPM usage bar, latency
- **Live Request Log** — provider, model, status, latency, tokens (last 100)
- **Usage by Provider** — requests, errors, avg latency per provider
- **Routing & Rotation Events** — fallback decisions, key rotation events
- **Rate Limit Gauges** — RPM/RPD bars for every configured provider

All data is live-polled every 3 seconds from `/api/stats`.

---

## Settings UI

The settings panel at `/settings` lets you manage everything without touching config files:

- **Providers** — enable/disable, edit API keys and rate limits, change routing tier, add new providers
- **Router** — switch routing strategy (priority / round-robin / least-busy / latency-based / random-weighted)
- **Gateway API Keys** — create and revoke named API keys for clients accessing `/v1/*`

### Gateway API Keys

LLMux supports **multiple named gateway API keys** — useful when you want to issue separate keys per integration, team, or app, and be able to revoke them individually.

**Creating a key via the UI:**
1. Open `/settings` → **Gateway** tab
2. Click **＋ New Key**
3. Enter a label (e.g. `production-app`, `vscode-extension`)
4. Copy the generated key — it is only shown once
5. Pass the key as a Bearer token: `Authorization: Bearer llmux-...`

**Revoking a key:**  
Click **Revoke** next to the key in the Gateway tab. Existing requests using that key immediately stop working.

> **Env-var key**: Setting `GATEWAY_API_KEY` in `.env` creates a permanent key that is always active alongside any UI-managed keys.

**Via API:**
```bash
# List keys
curl http://localhost:3000/api/admin/gateway-keys \
  -H "X-Admin-Token: $ADMIN_TOKEN"

# Create a key
curl -X POST http://localhost:3000/api/admin/gateway-keys \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-app"}'

# Delete a key
curl -X DELETE http://localhost:3000/api/admin/gateway-keys/<id> \
  -H "X-Admin-Token: $ADMIN_TOKEN"
```

---

## Playground

The built-in chat playground at `/playground` lets you test providers interactively:

- **Pin a provider** — select any loaded provider from the dropdown to route directly to it (bypasses the router strategy)
- **Select model** — choose from all models that provider offers
- **Streaming** — toggle real-time streaming on/off
- **Markdown rendering** — assistant responses render full markdown: headings, lists, fenced code blocks with copy buttons, tables, blockquotes
- **Status bar** — shows the provider name and model alias that served the last response

Playground requests count toward dashboard stats (Total Requests / Tokens Used) the same as API calls.

---

## Fallback Engine

3-level automatic fallback — transparent to your client:

```
Request
  → Primary provider (Tier 1)
      [429/timeout] → Same provider retry with backoff
      [still failing] → Next provider supporting same model
      [all model-specific fail] → Any available provider (same modality)
          → ✓ Response returned to client
```

---

## Adding a New Provider

4 steps:

**1. Create the provider class** (`src/providers/text/myprovider.ts`)
```typescript
import { BaseProvider } from "../base.js";

export class MyProvider extends BaseProvider {
  async chatCompletion(req, ctx) {
    const model = this.resolveModel(req.model);
    const res = await this.postJSON(`${this.config.baseUrl}/chat/completions`, { ...req, model }, ctx);
    if (req.stream) return this.proxyStream(res, ctx);
    const data = await res.json();
    // recordTokens updates both the rate-limit tracker and the dashboard stats
    await this.recordTokens(ctx, data.usage?.total_tokens ?? 0);
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  }
}
```

**2. Register in `src/providers/registry.ts`**
```typescript
import { MyProvider } from "./text/myprovider.js";
const PROVIDER_FACTORIES = {
  // ...
  "my-provider": MyProvider,
};
```

**3. Add to `config/providers.yaml`**
```yaml
- id: my-provider
  name: My Provider
  modality: text
  tier: 2
  enabled: true
  api_keys:
    - ${MY_PROVIDER_KEY}
  base_url: https://api.myprovider.com/v1
  models:
    - id: my-model-large
      alias: my-large
      context_window: 128000
  limits:
    rpm: 60
  concurrency: 5
  timeout: 30000
  max_retries: 2
```

**4. Add key to `.env` and restart**

---

## Deployment

### Docker
```bash
docker build -t llmux .
docker run -p 3000:3000 --env-file .env -v $(pwd)/config:/app/config llmux
```

### Docker Compose (with Redis for multi-instance)
```bash
docker compose up
```

### Railway / Vercel
Pre-configured — see `railway.toml` and `vercel.json`.

### Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Server port (default: 3000) |
| `GATEWAY_API_KEY` | Optional static auth key for `/v1/*` routes (always active alongside UI-managed keys) |
| `REDIS_URL` | Optional Redis for multi-instance rate limiting |
| `GROQ_API_KEY` | Groq API key |
| `GEMINI_API_KEY` | Google Gemini API key |
| `MISTRAL_API_KEY` | Mistral AI API key |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `CF_ACCOUNT_ID` / `CF_API_KEY` | Cloudflare Workers AI |
| `HF_API_KEY` | Hugging Face API key |
| `SAMBANOVA_API_KEY` | SambaNova API key |
| `COHERE_API_KEY` | Cohere API key |
| `DEEPSEEK_API_KEY` | DeepSeek API key |
| `NVIDIA_API_KEY` | NVIDIA NIM API key |
| `GITHUB_MODELS_TOKEN` | GitHub Models token |
| `POLLINATIONS_API_KEY` | Pollinations AI API key (optional) |
| `ELEVENLABS_API_KEY` | ElevenLabs API key |
| `DEEPGRAM_API_KEY` | Deepgram API key |
| `FISH_AUDIO_API_KEY` | Fish Audio API key |
| `KIMI_API_KEY` | Moonshot AI (Kimi) API key |
| `GLM_API_KEY` | Zhipu AI (GLM) API key |
| `XAI_API_KEY` | xAI Grok API key |

---

## Architecture

```
Client (any OpenAI SDK)
       │  POST /v1/chat/completions
       ▼
  ┌─────────────────────────────┐
  │     LLMux Gateway           │
  │  ┌──────────────────────┐   │
  │  │  Auth + Rate Limiter │   │
  │  └──────────┬───────────┘   │
  │  ┌──────────▼───────────┐   │
  │  │  Router + Strategy   │   │
  │  │  priority / rr / ... │   │
  │  └──────────┬───────────┘   │
  │  ┌──────────▼───────────┐   │
  │  │  Fallback Engine     │   │
  │  │  3-level retry/route │   │
  │  └──────────┬───────────┘   │
  │  ┌──────────▼───────────┐   │
  │  │  Provider Registry   │   │
  │  │  20+ providers       │   │
  │  │  key rotation pool   │   │
  │  └──────────┬───────────┘   │
  │  ┌──────────▼───────────┐   │
  │  │  Rate Limit Store    │   │
  │  │  Memory / Redis      │   │
  │  └──────────────────────┘   │
  └─────────────────────────────┘
       │ streams back to client
       ▼
   Response (SSE or JSON)
```

---

## API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/v1/chat/completions` | POST | OpenAI chat completions (streaming supported) |
| `/v1/completions` | POST | Legacy completions |
| `/v1/images/generations` | POST | Image generation |
| `/v1/audio/speech` | POST | Text to speech |
| `/v1/audio/transcriptions` | POST | Speech to text |
| `/v1/models` | GET | List all available models |
| `/health` | GET | Gateway health check |
| `/health/providers` | GET | Per-provider health + rate limit state |
| `/api/stats` | GET | Full stats: totals, providers, request log |
| `/api/stats/stream` | GET | SSE stream of live request events |
| `/dashboard` | GET | Live operational dashboard UI |
| `/settings` | GET | Settings UI (providers, router, gateway keys) |
| `/playground` | GET | Interactive chat playground |
| `/api/admin/gateway-keys` | GET | List gateway API keys |
| `/api/admin/gateway-keys` | POST | Create a new named gateway API key |
| `/api/admin/gateway-keys/:id` | DELETE | Revoke a gateway API key |

---

## License

MIT — use it, fork it, build on it. Stars appreciated ⭐

```
github.com/your-org/llmux
```
