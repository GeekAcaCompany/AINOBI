# @ainobi/tts

The text-to-speech capability port: the provider interface, the throwing default, and the registry. Implementations live in `@ainobi/tts-fishaudio`, `@ainobi/tts-google`, `@ainobi/tts-minimax`, or your own code; billing and audit wrap the port as decorators and never live inside an implementation.

Runtime: Node (audio is returned as a `Buffer`).

```ts
import { getTTSProvider } from '@ainobi/tts';

const audio = await getTTSProvider('fishaudio').textToSpeech({
  text: 'Hello',
  voice_id: 'voice-id',
  speed: 1,
  temperature: 0.7,
  top_p: 0.7,
  format: 'mp3',
});
```

## API

| Export | Description |
| --- | --- |
| `TTSProvider` | `textToSpeech(params)`, `close()`, and the billing hooks `get_service_code()` / `get_billable_units(text)`. |
| `TextToSpeechParams` | `text`, `voice_id`, `speed`, `temperature`, `top_p`, `format`, plus provider-specific fields. |
| `registerTTSProvider` / `getTTSProvider` / `unregisterTTSProvider` | The default registry. |
| `createTTSProviderRegistry()` | A caller-owned registry. |
| `countBillableCodePoints(text)` | The default billing unit (Unicode code points). |
| `ProviderNotConfiguredError`, `PortNotConfiguredError`, `PROVIDER_NOT_CONFIGURED` | The not-configured failure. |
| `TTSProviderKind` | Kinds of the built-in implementations. |

## Writing an implementation

The port is an interface plus a registry. Implement the interface, register it under a kind at your composition root, and resolve it by kind wherever it is used:

```ts
import { registerTTSProvider, getTTSProvider, type TTSProvider } from '@ainobi/tts';

class MyImplementation implements TTSProvider {
  // ...the members of TTSProvider
}

registerTTSProvider('my-kind', new MyImplementation());
const implementation = getTTSProvider('my-kind');
```

An unregistered kind resolves to a throwing default: calling it raises `ProviderNotConfiguredError` (code `PROVIDER_NOT_CONFIGURED`), so a missing registration fails loudly at call time instead of silently. `instanceof PortNotConfiguredError` (from `@ainobi/port-kit`, re-exported here) catches that failure from any port.

The functions above share one process-wide registry. A host that keeps several configurations in one process, or that avoids module-level state, owns its registry instead:

```ts
import { createTTSProviderRegistry } from '@ainobi/tts';

const registry = createTTSProviderRegistry();
registry.register('my-kind', new MyImplementation());
registry.get('my-kind').textToSpeech(params);
```

Kind constants list the built-in implementations only; any string is a valid kind.

## Using it outside this repository

The package is part of AINOBI-PRIVATE and is not published yet (`"private": true`). To use it elsewhere, build and pack it from the repository root:

```sh
pnpm --filter @ainobi/tts build
pnpm --filter @ainobi/tts pack --pack-destination ./tarballs
npm install ./tarballs/ainobi-tts-*.tgz
```

The tarball carries `dist/` (ESM, type declarations, source maps) and the published `exports`; internal `@ainobi/*` dependencies resolve to their own tarballs. `node scripts/verify-public-packages.mjs` checks that every public package installs and imports this way.
