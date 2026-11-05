# @ainobi/llm-vertexai

The Google Vertex AI implementation of the `@ainobi/llm` port.

Runtime: Node.

```ts
import { registerLLMProvider } from '@ainobi/llm';
import { VertexAIProvider } from '@ainobi/llm-vertexai';

registerLLMProvider('vertexai', new VertexAIProvider({ model: 'gemini-3.5-flash', api_key: process.env.VERTEXAI_API_KEY }));
```

The provider reads no environment variables: pass credentials and settings to the constructor at your composition root. It implements `BaseLLMProvider` from `@ainobi/llm`; see that package for the interface and the registry.

## Using it outside this repository

The package is part of AINOBI-PRIVATE and is not published yet (`"private": true`). To use it elsewhere, build and pack it from the repository root:

```sh
pnpm --filter @ainobi/llm-vertexai build
pnpm --filter @ainobi/llm-vertexai pack --pack-destination ./tarballs
npm install ./tarballs/ainobi-llm-vertexai-*.tgz
```

The tarball carries `dist/` (ESM, type declarations, source maps) and the published `exports`; internal `@ainobi/*` dependencies resolve to their own tarballs. `node scripts/verify-public-packages.mjs` checks that every public package installs and imports this way.
