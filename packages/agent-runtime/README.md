# @ainobi/agent-runtime

The agent host kernel shared by AINOBI's agent services: the Claude Code OS sandbox settings, the subprocess environment allowlist, the host clock line for prompts, Tavily web search, and runtime binary resolution. Hosts supply their policy and settings; nothing in the package reads the environment by itself.

Runtime: Node.

```ts
import { createAgentSandbox, createAgentSubprocessEnvPicker } from '@ainobi/agent-runtime';

const sandbox = createAgentSandbox({
  hostEnv: () => process.env,
  hostUrlEnvKeys: ['ANTHROPIC_BASE_URL', 'MY_TOOL_HOST_URL'],
});
const settings = sandbox.buildAgentSandboxSettings(apiBaseUrl, workspaceDir, agentEnv);
```

## API

| Export | Description |
| --- | --- |
| `createAgentSandbox(policy)` | Sandbox decisions (`shouldUseOsSandbox`, …) and `buildAgentSandboxSettings`: filesystem and network allowlists for the agent subprocess. On by default on macOS only; `AINOBI_AGENT_FORCE_SANDBOX` / `AINOBI_AGENT_DISABLE_SANDBOX` in the host env override. |
| `createAgentSubprocessEnvPicker(policy)` | Builds the agent's environment from an allowlist (`AGENT_BASE_INHERIT_KEYS`, `AGENT_BASE_INJECT_KEYS`). |
| `formatAgentCurrentTime(now, options)` | The current-time line for the system prompt. |
| Claude Code executable resolution | Locates the bundled Claude Code binary for the host platform. |
| Tavily search | The host-side web search the agent delegates to. |

## Using it outside this repository

The package is part of AINOBI-PRIVATE and is not published yet (`"private": true`). To use it elsewhere, build and pack it from the repository root:

```sh
pnpm --filter @ainobi/agent-runtime build
pnpm --filter @ainobi/agent-runtime pack --pack-destination ./tarballs
npm install ./tarballs/ainobi-agent-runtime-*.tgz
```

The tarball carries `dist/` (ESM, type declarations, source maps) and the published `exports`; internal `@ainobi/*` dependencies resolve to their own tarballs. `node scripts/verify-public-packages.mjs` checks that every public package installs and imports this way.
