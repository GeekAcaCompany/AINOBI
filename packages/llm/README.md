# @ainobi/llm

The LLM capability port: the streaming provider interface with the unified chunk shape, the model parameter table, the throwing default, and the registry. Implementations live in `@ainobi/llm-openai`, `@ainobi/llm-vertexai`, or your own code.

Runtime: Node.

```ts
import { getLLMProvider } from '@ainobi/llm';

const provider = getLLMProvider('openai');
const result = await provider.create_completion({
  messages: [{ role: 'user', content: 'Summarize this lesson.' }],
  max_tokens: 512,
});

for await (const chunk of provider.create_completion_stream({ messages: [{ role: 'user', content: 'Hi' }] })) {
  // one StreamChunk per delta
}
```

## API

| Export | Description |
| --- | --- |
| `BaseLLMProvider` | `create_completion(params)`, `create_completion_stream(params)`, `close()`, `supports_tools()`, `supports_thinking()`. |
| `CompletionParams` / `StreamParams` / `StreamChunk` | Request and streaming shapes; `extraParams` passes provider parameters through. |
| `TranscribingProvider` | Providers that also transcribe audio. |
| `registerLLMProvider` / `getLLMProvider` / `unregisterLLMProvider` | The default registry. |
| `createLLMProviderRegistry()` | A caller-owned registry. |
| Model parameter table | Per-model context, output, and parameter conventions (see `model_configs`). |
| `ProviderNotConfiguredError`, `PortNotConfiguredError`, `PROVIDER_NOT_CONFIGURED` | The not-configured failure. |
| `LLMProvider` | Kinds of the built-in providers. |

## Writing an implementation

The port is an interface plus a registry. Implement the interface, register it under a kind at your composition root, and resolve it by kind wherever it is used:

```ts
import { registerLLMProvider, getLLMProvider, type BaseLLMProvider } from '@ainobi/llm';

class MyImplementation implements BaseLLMProvider {
  // ...the members of BaseLLMProvider
}

registerLLMProvider('my-kind', new MyImplementation());
const implementation = getLLMProvider('my-kind');
```

An unregistered kind resolves to a throwing default: calling it raises `ProviderNotConfiguredError` (code `PROVIDER_NOT_CONFIGURED`), so a missing registration fails loudly at call time instead of silently. `instanceof PortNotConfiguredError` (from `@ainobi/port-kit`, re-exported here) catches that failure from any port.

The functions above share one process-wide registry. A host that keeps several configurations in one process, or that avoids module-level state, owns its registry instead:

```ts
import { createLLMProviderRegistry } from '@ainobi/llm';

const registry = createLLMProviderRegistry();
registry.register('my-kind', new MyImplementation());
registry.get('my-kind').create_completion(params);
```

Kind constants list the built-in implementations only; any string is a valid kind.

## Using it outside this repository

The package is part of AINOBI-PRIVATE and is not published yet (`"private": true`). To use it elsewhere, build and pack it from the repository root:

```sh
pnpm --filter @ainobi/llm build
pnpm --filter @ainobi/llm pack --pack-destination ./tarballs
npm install ./tarballs/ainobi-llm-*.tgz
```

The tarball carries `dist/` (ESM, type declarations, source maps) and the published `exports`; internal `@ainobi/*` dependencies resolve to their own tarballs. `node scripts/verify-public-packages.mjs` checks that every public package installs and imports this way.
