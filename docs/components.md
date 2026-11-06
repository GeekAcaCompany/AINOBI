# Components

Every piece of AINOBI, what it does, and what it needs. To install the smallest set for a goal, see the [integration guide](integration.md).

## Components for your app

These install into your project. None needs a server unless the table says so.

| Package | What it gives you | Runs in | Depends on |
| --- | --- | --- | --- |
| `@ainobi/avatar` | Live2D and Inochi2D rendering for React, with model caching and a shared stage | Browser | `@ainobi/courseware-core`, `inochi2d` |
| `@ainobi/avatar-generator` | Generates an Inochi2D avatar from a text description, with quality checks | Node.js, needs an image API key | Nothing |
| `@ainobi/courseware-core` | The courseware format: schema, validation, editing operations, quiz scoring. No React, Node.js APIs, or storage | Anywhere | Nothing |
| `@ainobi/courseware-player` | The stage, timeline, narration, quizzes, preview and render pages, and the client for the service's API | Browser, needs `courseware-service` | `@ainobi/avatar`, `@ainobi/courseware-core`, `@ainobi/api-contracts`, `@ainobi/web-kit` |
| `@ainobi/courseware-editor` | The courseware editor | Browser, needs `courseware-service` | `@ainobi/courseware-player` and its dependencies |
| `@ainobi/widgets` | `<ainobi-editor>`, `<ainobi-player>`, `<ainobi-avatar>`, and `<ainobi-login>` elements that frame a running Studio. `<ainobi-login>` is for the full platform | Any web page, needs Studio | Nothing |
| `@ainobi/client` | Sign-in hand-back, session, and courseware list for a host app | Browser or Node.js | `@ainobi/api-contracts` |
| `@ainobi/courseware-cli` | The `ainobi` command: create and edit courseware as JSON, for scripts and agents | Node.js | `@ainobi/courseware-core`, storage and voice packages |

## Services

| Service | What it does | Needs |
| --- | --- | --- |
| `apps/studio` | The complete system: a web app with the courseware list, editor, and preview, plus the embedded stores and the local host. Starts `courseware-service` | Node.js |
| `apps/courseware-service` | Stores courseware and assets, serves the agent's MCP endpoint, and runs the editor's AI assistant | Node.js, a PostgreSQL protocol database, a Redis protocol server, S3 protocol storage (Studio supplies all three) |
| `apps/video-render-service` | Exports courseware as video. Optional | Docker |
| `apps/pdf2html-service` | Converts uploaded PDF files into per-page HTML for slides. Optional ([docs/document-conversion.md](document-conversion.md)) | Docker |
| `apps/pptx2html-service` | Converts uploaded PowerPoint files into per-page HTML for slides. Optional | Docker |

## Building blocks

The packages above use these. You rarely install them yourself; use them to replace a part.

| Package | Purpose |
| --- | --- |
| `@ainobi/lite-stores` | PGlite behind the PostgreSQL protocol, an in-memory Redis server, and disk storage behind the S3 API |
| `@ainobi/db` | Data source helpers, including the option that lets services run on PGlite's single session |
| `@ainobi/http` | CORS, access logging, and the route registry |
| `@ainobi/backend-client` | How `courseware-service` reaches its identity host |
| `@ainobi/billing` | A stand-in with the billing interface and no billing: nothing is charged or refused |
| `@ainobi/api-contracts` | Shared schemas, enums, and error codes |
| `@ainobi/web-kit` | Browser utilities and form schemas |
| `@ainobi/agent-runtime` | Sandbox settings and subprocess handling for agent runs |
| `@ainobi/capability-client` | Detects which optional features a deployment has |
| `@ainobi/port-kit` | The registry behind the replaceable interfaces below |

## Replaceable parts

Each interface has implementations you can choose from, or you can write your own.

| Interface | Implementations |
| --- | --- |
| `@ainobi/storage` | `@ainobi/storage-impl` (S3 compatible, including local disk, Aliyun OSS, Oracle Cloud) |
| `@ainobi/tts` | `@ainobi/tts-fishaudio`, `@ainobi/tts-minimax`, `@ainobi/tts-google` |
| `@ainobi/llm` | `@ainobi/llm-openai`, `@ainobi/llm-vertexai` |
| `@ainobi/doc-converter` | Interface only; supply your own converter |

## Vendored

| Package | Source |
| --- | --- |
| `inochi2d` | A build of Inochi2D/inochi2d-ts; see [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) |
