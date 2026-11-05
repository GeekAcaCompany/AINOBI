# @ainobi/port-kit

Shared building blocks of the AINOBI capability ports: the not-configured error and the provider registry that `@ainobi/tts`, `@ainobi/llm`, `@ainobi/storage` and `@ainobi/doc-converter` are built on. Use it to write a port of your own with the same conventions.

Runtime: any (no Node or DOM APIs, no dependencies).

```ts
import { createProviderRegistry, PortNotConfiguredError } from '@ainobi/port-kit';

interface Translator {
  translate(text: string, to: string): Promise<string>;
}

class TranslatorNotConfiguredError extends PortNotConfiguredError {
  constructor(kind: string) {
    super('Translator', kind);
  }
}

const translators = createProviderRegistry<Translator>((kind) => ({
  translate: async () => {
    throw new TranslatorNotConfiguredError(kind);
  },
}));

translators.register('deepl', myDeeplTranslator);
await translators.get('deepl').translate('hello', 'ja');
```

## API

| Export | Description |
| --- | --- |
| `createProviderRegistry(fallback)` | A kind → implementation registry: `register`, `unregister(kind?)`, `get`, `has`, `kinds`. `get` returns `fallback(kind)` for an unregistered kind. |
| `ProviderRegistry<P>` | The registry interface. |
| `PortNotConfiguredError` | Base error of "no implementation registered": `code` is `PROVIDER_NOT_CONFIGURED`, plus `subject` and `kind`. |
| `PROVIDER_NOT_CONFIGURED` | The error code. |

## Using it outside this repository

The package is part of AINOBI-PRIVATE and is not published yet (`"private": true`). To use it elsewhere, build and pack it from the repository root:

```sh
pnpm --filter @ainobi/port-kit build
pnpm --filter @ainobi/port-kit pack --pack-destination ./tarballs
npm install ./tarballs/ainobi-port-kit-*.tgz
```

The tarball carries `dist/` (ESM, type declarations, source maps) and the published `exports`; internal `@ainobi/*` dependencies resolve to their own tarballs. `node scripts/verify-public-packages.mjs` checks that every public package installs and imports this way.
