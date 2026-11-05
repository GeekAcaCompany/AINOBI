# @ainobi/client

The AINOBI platform SDK for host applications: exchange a sign-in handoff for a session, read the session and organizations, choose the working organization, list coursewares, and mint the one-time codes that sign embedded AINOBI pages in (see `@ainobi/widgets`).

Runtime: browser or Node (uses `fetch`; inject your own with the `fetch` option).

```ts
import { createAinobiClient } from '@ainobi/client';

const client = createAinobiClient({
  apiBase: 'https://api.example.com/v1',
  coursewareApiBase: 'https://courseware.example.com',
});

await client.signInWithHandoff(codeFromTheLoginPage);
const [organization] = await client.listOrganizations();
await client.chooseOrganization(organization.org_id);
const page = await client.listCoursewares({ orgId: organization.org_id, pageSize: 20 });
const handoff = await client.mintEmbedHandoff({ coursewareId: page.items[0]?.id });
```

## API

| Member | Description |
| --- | --- |
| `createAinobiClient(options)` / `new AinobiClient(options)` | `apiBase`, `coursewareApiBase`, optional `accessToken` to resume a session, optional `fetch`. |
| `signInWithHandoff(code)` | Exchanges a one-time handoff code for a session. |
| `getSession()`, `listOrganizations()`, `chooseOrganization(orgId)` | Session and organization context. |
| `updateCharacterConfig({ voiceName, personalityPrompt })` | The account's personal avatar config (Gemini Live voice, personality prompt). |
| `listCoursewares({ orgId, pageNumber, pageSize, title })` | A `Page<CoursewareSummary>`. |
| `mintEmbedHandoff({ coursewareId, orgId })` | A one-time code for an embedded page. |
| `signOut()` | Ends the session. |
| `AinobiApiError` | Raised for non-success responses (status and platform error code). |

Set `apiBase` explicitly; the built-in default is the AINOBI production API.

## Using it outside this repository

The package is part of AINOBI-PRIVATE and is not published yet (`"private": true`). To use it elsewhere, build and pack it from the repository root:

```sh
pnpm --filter @ainobi/client build
pnpm --filter @ainobi/client pack --pack-destination ./tarballs
npm install ./tarballs/ainobi-client-*.tgz
```

The tarball carries `dist/` (ESM, type declarations, source maps) and the published `exports`; internal `@ainobi/*` dependencies resolve to their own tarballs. `node scripts/verify-public-packages.mjs` checks that every public package installs and imports this way.
