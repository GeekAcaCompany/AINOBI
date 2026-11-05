# @ainobi/doc-converter

The document conversion capability port: one interface over in-process parsers (PDF/PPTX text and page extraction) and the remote pdf2html / pptx2html services (one standalone HTML page per document page, stored under artifact keys). Keeping one contract lets a deployment swap a parser for a service without touching callers.

Runtime: Node.

```ts
import { getDocConverter, isConvertedDocument } from '@ainobi/doc-converter';

const result = await getDocConverter('pptx2html').convert({ key: 'abc' });
if (isConvertedDocument(result)) {
  console.log(result.pageCount, result.pageKeys);
} else {
  console.log(result.pages.map((page) => page.text));
}
```

## API

| Export | Description |
| --- | --- |
| `DocConverter` | `convert(params)` → `ExtractedDocument` (structured pages) or `ConvertedDocument` (stored HTML pages). |
| `isExtractedDocument` / `isConvertedDocument` | Narrow a result to one of the two shapes. |
| `ConvertParams` | `content` (bytes, in-process) or `key` (storage key, service converters). |
| `registerDocConverter` / `getDocConverter` / `unregisterDocConverter` | The default registry. |
| `createDocConverterRegistry()` | A caller-owned registry. |
| `ProviderNotConfiguredError`, `PortNotConfiguredError`, `PROVIDER_NOT_CONFIGURED` | The not-configured failure. |
| `DocConverterKind` | Kinds of the built-in converters. |

## Writing an implementation

The port is an interface plus a registry. Implement the interface, register it under a kind at your composition root, and resolve it by kind wherever it is used:

```ts
import { registerDocConverter, getDocConverter, type DocConverter } from '@ainobi/doc-converter';

class MyImplementation implements DocConverter {
  // ...the members of DocConverter
}

registerDocConverter('my-kind', new MyImplementation());
const implementation = getDocConverter('my-kind');
```

An unregistered kind resolves to a throwing default: calling it raises `ProviderNotConfiguredError` (code `PROVIDER_NOT_CONFIGURED`), so a missing registration fails loudly at call time instead of silently. `instanceof PortNotConfiguredError` (from `@ainobi/port-kit`, re-exported here) catches that failure from any port.

The functions above share one process-wide registry. A host that keeps several configurations in one process, or that avoids module-level state, owns its registry instead:

```ts
import { createDocConverterRegistry } from '@ainobi/doc-converter';

const registry = createDocConverterRegistry();
registry.register('my-kind', new MyImplementation());
registry.get('my-kind').convert(params);
```

Kind constants list the built-in implementations only; any string is a valid kind.

## Using it outside this repository

The package is part of AINOBI-PRIVATE and is not published yet (`"private": true`). To use it elsewhere, build and pack it from the repository root:

```sh
pnpm --filter @ainobi/doc-converter build
pnpm --filter @ainobi/doc-converter pack --pack-destination ./tarballs
npm install ./tarballs/ainobi-doc-converter-*.tgz
```

The tarball carries `dist/` (ESM, type declarations, source maps) and the published `exports`; internal `@ainobi/*` dependencies resolve to their own tarballs. `node scripts/verify-public-packages.mjs` checks that every public package installs and imports this way.
