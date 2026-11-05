# @ainobi/web-kit

Browser-side pieces the AINOBI frontends share: yup response schemas for common records, frontend-only enums (LLM provider, question types), the exception level enum, and small utilities (uuid, query and timestamp helpers).

Runtime: browser.

```ts
import { generateUuidV4, isUuidV4 } from '@ainobi/web-kit/lib/uuid';
import { ExceptionLevel } from '@ainobi/web-kit/lib/enums/exception';
```

## Entry points

| Subpath | Content |
| --- | --- |
| `@ainobi/web-kit/schemas/<module>` | yup schemas of common response records. |
| `@ainobi/web-kit/enums/<module>` | Frontend enums. |
| `@ainobi/web-kit/lib/enums/<module>` | Library enums (e.g. `exception`). |
| `@ainobi/web-kit/lib/util`, `@ainobi/web-kit/lib/uuid` | Utilities. |

## Using it outside this repository

The package is part of AINOBI-PRIVATE and is not published yet (`"private": true`). To use it elsewhere, build and pack it from the repository root:

```sh
pnpm --filter @ainobi/web-kit build
pnpm --filter @ainobi/web-kit pack --pack-destination ./tarballs
npm install ./tarballs/ainobi-web-kit-*.tgz
```

The tarball carries `dist/` (ESM, type declarations, source maps) and the published `exports`; internal `@ainobi/*` dependencies resolve to their own tarballs. `node scripts/verify-public-packages.mjs` checks that every public package installs and imports this way.
