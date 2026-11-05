# @ainobi/api-contracts

The AINOBI platform contract: the zod schemas of the API's request and response bodies, the domain enums, the error-code table (HTTP status × 1000 + business code), and the response envelope. The backend validates with these schemas and the frontends type their calls with them, so there is one source of truth; the backend's golden OpenAPI document remains the HTTP-level gate.

Runtime: any (zod and decimal.js only).

```ts
import { ErrorCode } from '@ainobi/api-contracts/core/errors';
import { CourseStatus } from '@ainobi/api-contracts/enums/course';
import { UserSessionSchema } from '@ainobi/api-contracts/schemas/user';

const session = UserSessionSchema.parse(await response.json());
```

## Entry points

| Subpath | Content |
| --- | --- |
| `@ainobi/api-contracts` | Every schema and enum module as a namespace (`courseSchema`, `aiTeacherSchema`, …), plus `errors`, `envelope` and the shared agent message types. |
| `@ainobi/api-contracts/schemas/<module>` | One module per API area (`user`, `course`, `ai_teacher`, `stripe`, …). |
| `@ainobi/api-contracts/enums/<module>` | The domain enums. |
| `@ainobi/api-contracts/core/<module>` | `errors` (`ErrorCode`, `ApiError`) and the other core definitions. |
| `@ainobi/api-contracts/envelope`, `/serialize` | The response envelope and the wire serializers. |

The `py*` helpers in `schemas/helpers` reproduce the original Python backend's validation edge cases so responses stay byte-compatible; they are building blocks of the schemas, not an API to build on.

## Using it outside this repository

The package is part of AINOBI-PRIVATE and is not published yet (`"private": true`). To use it elsewhere, build and pack it from the repository root:

```sh
pnpm --filter @ainobi/api-contracts build
pnpm --filter @ainobi/api-contracts pack --pack-destination ./tarballs
npm install ./tarballs/ainobi-api-contracts-*.tgz
```

The tarball carries `dist/` (ESM, type declarations, source maps) and the published `exports`; internal `@ainobi/*` dependencies resolve to their own tarballs. `node scripts/verify-public-packages.mjs` checks that every public package installs and imports this way.
