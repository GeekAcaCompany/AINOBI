# @ainobi/llm-openai

The OpenAI-compatible implementation of the `@ainobi/llm` port: OpenAI and any API that speaks the Chat Completions protocol (set `api_base`). Extra parameters pass straight through to the API.

Runtime: Node.

```ts
import { registerLLMProvider } from '@ainobi/llm';
import { OpenAIProvider } from '@ainobi/llm-openai';

registerLLMProvider('openai', new OpenAIProvider({ model: 'gpt-5.6-sol', api_key: process.env.OPENAI_API_KEY }));
```

The provider reads no environment variables: pass credentials and settings to the constructor at your composition root. It implements `BaseLLMProvider` from `@ainobi/llm`; see that package for the interface and the registry.

## Using it outside this repository

The package is part of AINOBI-PRIVATE and is not published yet (`"private": true`). To use it elsewhere, build and pack it from the repository root:

```sh
pnpm --filter @ainobi/llm-openai build
pnpm --filter @ainobi/llm-openai pack --pack-destination ./tarballs
npm install ./tarballs/ainobi-llm-openai-*.tgz
```

The tarball carries `dist/` (ESM, type declarations, source maps) and the published `exports`; internal `@ainobi/*` dependencies resolve to their own tarballs. `node scripts/verify-public-packages.mjs` checks that every public package installs and imports this way.
