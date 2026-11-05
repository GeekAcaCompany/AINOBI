# AINOBI Courseware CLI

AI Agent friendly CLI for AINOBI courseware JSON. The CLI keeps the loaded scene in shell-scoped state, so an agent can run a sequence of commands without repeatedly passing the JSON path or scene id.

## Install

Inside this repository:

```sh
pnpm install
node ./bin/ainobi.mjs --version
```

`bin/ainobi.mjs` runs the TypeScript sources through tsx. The published package instead runs the compiled `dist/cli/index.js` and needs no TypeScript tooling. The package is not published yet (`"private": true`); to use it elsewhere, build and pack it from the repository root:

```sh
pnpm --filter @ainobi/courseware-cli build
pnpm --filter @ainobi/courseware-cli pack --pack-destination ./tarballs
npm install ./tarballs/ainobi-courseware-cli-*.tgz   # provides the `ainobi` command
```

`node scripts/verify-public-packages.mjs` checks that the packed CLI installs, runs `ainobi --version` and `ainobi help`, and that its library modules import and typecheck.

## Configuration

Everything is configured through environment variables, read in one place (`cli/env.ts`); [CONFIGURATION.md](CONFIGURATION.md) lists them by capability. With `AINOBI_CLI_RUNTIME=agent` and the host delegation switches, the CLI hands persistence, assets, narration, TTS, search, documents, and images to an AINOBI host over HTTP; without them it calls the vendors directly with the credentials it is given.

## Using the modules as a library

The modules exported under `@ainobi/courseware-cli/cli/*` (assets, TTS, URL policy, template extraction, …) can run inside a host process. Give each call its own settings with `runWithCliEnv` instead of changing the host's environment; concurrent calls never see each other's values:

```ts
import { runWithCliEnv } from '@ainobi/courseware-cli/cli/env';
import { synthesizeAndUploadTtsLine } from '@ainobi/courseware-cli/cli/tts';

const line = await runWithCliEnv({ AINOBI_COURSEWARE_ORG_ID: orgId }, () =>
  synthesizeAndUploadTtsLine({ text, settings, pronunciationDict }),
);
```

Inside this repository the same subpaths carry the source extension (`@ainobi/courseware-cli/cli/tts.ts`).

## Core Flow

```sh
node ./bin/ainobi.mjs load scene-1.json
node ./bin/ainobi.mjs status
node ./bin/ainobi.mjs scene info
node ./bin/ainobi.mjs slide list
node ./bin/ainobi.mjs element list 0
node ./bin/ainobi.mjs save output.json
```

Pipe input is supported:

```sh
printf '%s' '{"scene_id":"sc_demo","name":"demo","controller":{"play":true,"next":true,"back":true,"seekBar":true,"time":true,"slideNumber":true,"volume":true,"fullScreen":true,"brand":true,"playbackRate":true},"transitions":[],"preset_script":"","metadata":{},"slide_elements":[],"vtuber_elements":[]}' \
  | node ./bin/ainobi.mjs load -
```

## State Model

State is stored per shell session. `init` and `load` create a unique `session_id`, return it in JSON output, and bind it to the current shell so consecutive commands from that shell edit the same loaded scene.

Useful overrides:

- `AINOBI_SESSION=my-agent-run` shares state across processes.
- `AINOBI_SHELL_SESSION=my-shell-key` changes the shell key used for automatic binding.
- `AINOBI_STATE_DIR=/tmp/ainobi-state` changes where state files are stored.

## Slide Commands

```sh
node ./bin/ainobi.mjs slide list
node ./bin/ainobi.mjs slide get 0
node ./bin/ainobi.mjs slide get el_slide_xxx --with-children
node ./bin/ainobi.mjs slide insert --at 1 --name "New slide" --background "#123456" --duration 3000
node ./bin/ainobi.mjs slide update 1 --name "Updated slide" --set timeline.end_at=8000
node ./bin/ainobi.mjs slide delete 1
```

`slide insert` and `slide update` reject `children_elements`. Manage slide children through `element` commands.

## Element Commands

```sh
node ./bin/ainobi.mjs element list 0
node ./bin/ainobi.mjs element get 0 2
node ./bin/ainobi.mjs element insert 0 --type text --name "Title" --set text="Hello" --set font_size=64 --set size.width=1200 --set size.height=140
node ./bin/ainobi.mjs element update 0 0 --set text="Updated" --set style.z_index=10
node ./bin/ainobi.mjs element delete 0 0
```

All IDs are generated internally. Do not pass `scene_id`, `element_id`, or `binding_id`.

## Usage Docs For Agents

```sh
node ./bin/ainobi.mjs help
node ./bin/ainobi.mjs help types
node ./bin/ainobi.mjs help enums
node ./bin/ainobi.mjs help scene
node ./bin/ainobi.mjs help element text
node ./bin/ainobi.mjs help element image
```

Every command returns JSON. Validation failures return structured issues with `path`, `message`, and when possible the invalid `value`, for example:

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "slide[0].children_elements[] failed validation.",
    "issues": [
      {
        "path": "slide[0].children_elements[].font_size",
        "message": "font_size must be greater than 0",
        "value": 0
      }
    ]
  }
}
```

## Smoke Test

```sh
node ./bin/ainobi.mjs reset
node ./bin/ainobi.mjs load scene-1.json
node ./bin/ainobi.mjs slide insert --at 1 --name AgentTest --duration 3000
node ./bin/ainobi.mjs element insert 1 --type text --set text="Hello" --set font_size=40
node ./bin/ainobi.mjs element update 1 0 --set text="Updated"
node ./bin/ainobi.mjs element delete 1 0
node ./bin/ainobi.mjs slide delete 1
pnpm exec tsc --noEmit
```
