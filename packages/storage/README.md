# @ainobi/storage

The object storage capability port: one client surface over Aliyun OSS and S3-compatible stores, the throwing default, and the registry. `@ainobi/storage-impl` provides the Aliyun OSS and S3-compatible implementations.

Runtime: Node (object bodies are `Buffer`s).

Two behaviors are part of the contract: presigned URL formats must stay byte-identical (stored objects and caches depend on them), and implementations catch SDK and network errors, log them, and return `false` / `null` / `[]` instead of throwing.

```ts
import { getStorageProvider } from '@ainobi/storage';

const storage = getStorageProvider('aliyun_oss');
const uploadUrl = await storage.getPresignedUrlForUpload('raw/pdf/abc.pdf', 3600, 'application/pdf');
const body = await storage.downloadFile('raw/pdf/abc.pdf');
```

## API

| Export | Description |
| --- | --- |
| `StorageProvider` | Presigned upload/download URLs, upload, download, delete, list, copy, and public-access toggling; the `*InBucket` / `*FromBucket` variants address a bucket other than the default. |
| `StoredObject` | A listing entry. |
| `registerStorageProvider` / `getStorageProvider` / `unregisterStorageProvider` | The default registry. |
| `createStorageProviderRegistry()` | A caller-owned registry. |
| `ProviderNotConfiguredError`, `PortNotConfiguredError`, `PROVIDER_NOT_CONFIGURED` | The not-configured failure. |
| `StorageProviderKind` | Kinds of the built-in implementations. |

## Writing an implementation

The port is an interface plus a registry. Implement the interface, register it under a kind at your composition root, and resolve it by kind wherever it is used:

```ts
import { registerStorageProvider, getStorageProvider, type StorageProvider } from '@ainobi/storage';

class MyImplementation implements StorageProvider {
  // ...the members of StorageProvider
}

registerStorageProvider('my-kind', new MyImplementation());
const implementation = getStorageProvider('my-kind');
```

An unregistered kind resolves to a throwing default: calling it raises `ProviderNotConfiguredError` (code `PROVIDER_NOT_CONFIGURED`), so a missing registration fails loudly at call time instead of silently. `instanceof PortNotConfiguredError` (from `@ainobi/port-kit`, re-exported here) catches that failure from any port.

The functions above share one process-wide registry. A host that keeps several configurations in one process, or that avoids module-level state, owns its registry instead:

```ts
import { createStorageProviderRegistry } from '@ainobi/storage';

const registry = createStorageProviderRegistry();
registry.register('my-kind', new MyImplementation());
registry.get('my-kind').downloadFile(key);
```

Kind constants list the built-in implementations only; any string is a valid kind.

## Using it outside this repository

The package is part of AINOBI-PRIVATE and is not published yet (`"private": true`). To use it elsewhere, build and pack it from the repository root:

```sh
pnpm --filter @ainobi/storage build
pnpm --filter @ainobi/storage pack --pack-destination ./tarballs
npm install ./tarballs/example-storage-*.tgz
```

The tarball carries `dist/` (ESM, type declarations, source maps) and the published `exports`; internal `@ainobi/*` dependencies resolve to their own tarballs. `node scripts/verify-public-packages.mjs` checks that every public package installs and imports this way.
