# Contributing to LLMux

Thank you for your interest in contributing! LLMux is an open-source project and we welcome contributions of all kinds.

## Quick start

```bash
git clone https://github.com/your-org/llmux.git
cd llmux
pnpm install
cp .env.example .env   # add at least one API key
pnpm dev
```

## Adding a new provider

1. Create a file in `src/providers/<modality>/<provider-name>.ts`
2. Extend `BaseProvider` and implement `chatCompletion()` (or the relevant method for the modality)
3. Register the provider in `src/providers/registry.ts` — add your class to `PROVIDER_FACTORIES`
4. Add the provider config block to `config/providers.yaml` and `providers.yaml.example`
5. Add the required API key to `.env.example`
6. Write tests in `tests/providers.test.ts`

### Provider template

```typescript
import type { ChatCompletionRequest } from "../../types/openai.js";
import type { RequestContext } from "../../types/provider.js";
import { BaseProvider } from "../base.js";

export class MyProvider extends BaseProvider {
  async chatCompletion(req: ChatCompletionRequest, ctx: RequestContext): Promise<Response> {
    const model = this.resolveModel(req.model);
    const url = `${this.config.baseUrl}/chat/completions`;

    const res = await this.postJSON(url, { ...req, model }, ctx);

    if (req.stream) return this.proxyStream(res, ctx);

    const data = await res.json();
    const tokens = (data as any).usage?.total_tokens ?? 0;
    await this.rateLimitTracker.recordSuccess(tokens);

    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", "X-Provider": this.config.id },
    });
  }
}
```

## Code style

- TypeScript strict mode — no `any` except where unavoidable
- No default exports except in `src/index.ts`
- All async errors must be caught — never let unhandled promise rejections escape a route handler
- Use `logger.info/debug/warn/error` from `src/middleware/logger.ts`, not `console.log`

## Testing

```bash
pnpm test          # run all tests
pnpm test:watch    # watch mode
```

Tests live in `tests/`. Unit test pure functions. Integration tests (that call real APIs) are not in the test suite — use `pnpm dev` for manual integration testing.

## Pull request checklist

- [ ] New provider added to `registry.ts` and `providers.yaml`
- [ ] API key added to `.env.example`
- [ ] Tests pass: `pnpm test`
- [ ] Type-check passes: `pnpm lint`
- [ ] No new `any` types introduced without comment
- [ ] PR description explains the provider, its free tier limits, and any adapter quirks

## Reporting issues

Please open a GitHub issue with:
- LLMux version
- Provider name
- Expected vs actual behavior
- Sanitised logs (remove API keys!)
