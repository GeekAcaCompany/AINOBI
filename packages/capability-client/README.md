# @ainobi/capability-client

Framework-agnostic feature detection for AINOBI frontends: fetches the backend's `GET /public/capabilities` (which optional capabilities — TTS providers, live classroom, payments — a deployment has configured) and keeps them in a small queryable store for feature gating.

Runtime: browser or Node (uses `fetch`).

```ts
import { createCapabilityStore } from '@ainobi/capability-client';

const capabilities = createCapabilityStore();
await capabilities.load('https://api.example.com/v1');

if (capabilities.isAvailable('live.bbb')) {
  showLiveClassroom();
} else {
  console.log(capabilities.getStatus('live.bbb')?.reason);
}
```

## API

| Export | Description |
| --- | --- |
| `createCapabilityStore()` | `load(apiBase)`, `isAvailable(key)`, `getStatus(key)`, `isLoaded()`. |
| `fetchCapabilities(apiBase)` | One request, returning the `CapabilityMap`. |
| `CapabilityStatus` | `available`, `package`, `label`, and `reason` when unavailable. |

## Using it outside this repository

The package is part of AINOBI-PRIVATE and is not published yet (`"private": true`). To use it elsewhere, build and pack it from the repository root:

```sh
pnpm --filter @ainobi/capability-client build
pnpm --filter @ainobi/capability-client pack --pack-destination ./tarballs
npm install ./tarballs/ainobi-capability-client-*.tgz
```

The tarball carries `dist/` (ESM, type declarations, source maps) and the published `exports`; internal `@ainobi/*` dependencies resolve to their own tarballs. `node scripts/verify-public-packages.mjs` checks that every public package installs and imports this way.
