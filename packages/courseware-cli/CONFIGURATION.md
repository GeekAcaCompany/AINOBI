# Configuration

The CLI is configured through environment variables, all read through `cliEnv()` in `cli/env.ts`. In the `ainobi` process that is `process.env`, plus the `.env` files of the package directory and of the working directory, loaded at startup without overriding variables that are already set.

A host that imports the CLI modules as a library — the courseware service runs narration, asset upload, and TTS in-process — passes settings per call instead of mutating its own environment:

```ts
import { runWithCliEnv } from '@ainobi/courseware-cli/cli/env';

await runWithCliEnv({ AINOBI_COURSEWARE_ORG_ID: orgId, OSS_BUCKET: bucket }, () => synthesizeAndUploadTtsLine(options));
```

The overrides apply to everything the callback awaits and to nothing else, so concurrent calls never see each other's values.

## Runtime and session state

| Variable | Meaning |
| --- | --- |
| `AINOBI_CLI_RUNTIME` | `agent` when an AINOBI host runs the CLI for its agent; enables the host delegation switches below. |
| `AINOBI_SESSION` | Explicit session id; shares one loaded scene across processes. |
| `AINOBI_SHELL_SESSION` | Key that binds a shell to its session (defaults to the parent process). |
| `AINOBI_STATE_DIR` | Where session state is stored (default: the system temp directory). |
| `AINOBI_OUTPUT_DIR` | Directory `save` writes to when no path is given. |
| `AINOBI_CONVERSATION_ID`, `AINOBI_CLAUDE_SESSION_ID` | The host conversation and agent session the CLI runs in (recall and narration jobs). |

## Host delegation (agent runtime)

With `AINOBI_CLI_RUNTIME=agent`, each switch set to `1` hands that capability to the AINOBI host over HTTP instead of calling a vendor directly. `AINOBI_AGENT_API_KEY` authenticates every host call.

| Switch | Host endpoint | Timeout |
| --- | --- | --- |
| `AINOBI_PERSISTENCE_HOST_FLUSH` | `AINOBI_COURSEWARE_PERSISTENCE_URL` | — |
| `AINOBI_ASSET_HOST_FLUSH` | `AINOBI_COURSEWARE_ASSET_UPLOAD_URL`, `AINOBI_COURSEWARE_ASSET_GET_URL` | — |
| `AINOBI_NARRATION_HOST_FLUSH` | `AINOBI_NARRATION_HOST_URL` | `AINOBI_NARRATION_HOST_TIMEOUT_MS` |
| `AINOBI_TTS_HOST_FLUSH` | `AINOBI_TTS_HOST_URL` | `AINOBI_TTS_HOST_TIMEOUT_MS` |
| `AINOBI_SEARCH_HOST_FLUSH` | `AINOBI_SEARCH_HOST_URL` | `AINOBI_SEARCH_HOST_TIMEOUT_MS` |
| `AINOBI_DOC_HOST_FLUSH` | `AINOBI_DOC_HOST_URL` | `AINOBI_DOC_HOST_TIMEOUT_MS` |
| `AINOBI_IMAGE_GENERATE_HOST_FLUSH` | `AINOBI_IMAGE_GENERATE_HOST_URL` | `AINOBI_IMAGE_GENERATE_HOST_TIMEOUT_MS` |
| `AINOBI_IMAGE_REPLICATE_HOST_FLUSH` | `AINOBI_IMAGE_REPLICATE_HOST_URL` | `AINOBI_IMAGE_REPLICATE_HOST_TIMEOUT_MS` |
| `AINOBI_AI_TEACHERS_HOST_FLUSH` | `AINOBI_AI_TEACHERS_HOST_URL` | `AINOBI_AI_TEACHERS_HOST_TIMEOUT_MS` |
| `AINOBI_DESIGN_TEMPLATE_HOST_FLUSH` | `AINOBI_DESIGN_TEMPLATE_HOST_BASE` | `AINOBI_DESIGN_TEMPLATE_HOST_TIMEOUT_MS` |
| `AINOBI_CONTENT_TEMPLATE_HOST_FLUSH` | `AINOBI_CONTENT_TEMPLATE_HOST_BASE` | `AINOBI_CONTENT_TEMPLATE_HOST_TIMEOUT_MS` |

Always host-side: `AINOBI_KNOWLEDGE_HOST_URL` (knowledge commands; `AINOBI_KNOWLEDGE_CATALOG_PATH` overrides the catalog file) and `AINOBI_TOOL_RESULT_RECALL_HOST_URL` (recall).

## Courseware context

| Variable | Meaning |
| --- | --- |
| `AINOBI_COURSEWARE_ID`, `AINOBI_COURSEWARE_KEY` | The courseware being edited. |
| `AINOBI_COURSEWARE_ORG_ID` | Its organization (voice catalogs, billing). |
| `AINOBI_SECTION_ID` | The course section (knowledge commands). |
| `AINOBI_COURSEWARE_SYNCED_AT` | The host's `updated_at` baseline, stored by `load` for sync checks. |

## Storage (local runtime)

| Variable | Meaning |
| --- | --- |
| `STORAGE_BACKEND` | `aliyun_oss` (default) or `oci_s3`. |
| `OSS_BUCKET`, `OSS_REGION`, `OSS_ENDPOINT`, `OSS_SECURE`, `OSS_TIMEOUT` | Aliyun OSS location and client settings. |
| `ALIYUN_ACCESS_KEY_ID`, `ALIYUN_ACCESS_KEY_SECRET` | Aliyun OSS credentials. |
| `OSS_UPLOAD_MAX_RETRIES`, `OSS_UPLOAD_RETRY_BASE_MS`, `OSS_UPLOAD_RETRY_MAX_MS` | Upload retry policy. |
| `OSS_MULTIPART_THRESHOLD_MB`, `OSS_MULTIPART_PART_SIZE_MB` | Multipart upload sizing. |
| `OCI_S3_ENDPOINT`, `OCI_S3_REGION`, `OCI_S3_BUCKET`, `OCI_S3_NAMESPACE`, `OCI_S3_URL_EXPIRES` | OCI Object Storage (S3-compatible) location. |
| `AINOBI_STORAGE_LOCAL_ENDPOINT` | `true` marks an `http://` `OCI_S3_ENDPOINT` as a local store, so its URLs stay `http://`. Set only by `pnpm lite`; otherwise URLs are always `https://`. |
| `OCI_S3_ACCESS_KEY_ID`, `OCI_S3_SECRET_KEY` | OCI credentials. |
| `OSS_PUBLIC_BASE_URL`, `AINOBI_COURSEWARE_ASSET_BASE_URL`, `COURSEWARE_HTML_ASSET_BASE_URL` | Public base URLs written into scenes. |
| `COURSEWARE_ASSET_BASE_URLS`, `AINOBI_COURSEWARE_ASSET_BASE_URLS` | Extra base URLs recognized as AINOBI assets. |

## Text-to-speech (local runtime)

| Variable | Meaning |
| --- | --- |
| `AINOBI_TTS_STUB` | Return stub audio URLs without calling a vendor (tests). |
| `AINOBI_TTS_MAX_RETRIES`, `AINOBI_TTS_RETRY_DELAY_MS` | Retry policy of each synthesized line. |
| `AINOBI_TTS_PRONUNCIATION_DICT_FILE`, `AINOBI_TTS_JA_KANA_LINES_FILE` | Host-written pronunciation dictionary and Japanese kana rewrites for narration. |
| `FISH_AUDIO_API_KEY`, `FISH_AUDIO_TTS_URL` | Fish Audio credentials and endpoint. |
| `FISH_AUDIO_TTS_MODEL`, `FISH_AUDIO_TTS_VOICE_ID` | Default model and voice. |
| `FISH_AUDIO_TTS_FORMAT`, `FISH_AUDIO_TTS_MP3_BITRATE`, `FISH_AUDIO_TTS_SYNTHESIS_TIMEOUT_MS` | Output and timeout. |
| `MINIMAX_API_KEY`, `MINIMAX_TTS_WS_URL` | MiniMax credentials and WebSocket endpoint. |
| `MINIMAX_TTS_MODEL`, `MINIMAX_TTS_VOICE_ID`, `MINIMAX_TTS_SPEED`, `MINIMAX_TTS_VOL`, `MINIMAX_TTS_PITCH` | Default voice settings. |
| `MINIMAX_TTS_FORMAT`, `MINIMAX_TTS_SAMPLE_RATE`, `MINIMAX_TTS_BITRATE`, `MINIMAX_TTS_CHANNEL`, `MINIMAX_TTS_ENGLISH_NORMALIZATION` | Output settings. |
| `MINIMAX_TTS_CONNECT_TIMEOUT_MS`, `MINIMAX_TTS_SYNTHESIS_TIMEOUT_MS` | Timeouts. |
| `GOOGLE_APPLICATION_CREDENTIALS` or `GOOGLE_APPLICATION_CREDENTIALS_JSON`, `VERTEXAI_PROJECT_ID` / `GOOGLE_CLOUD_PROJECT`, `GEMINI_TTS_LOCATION`, `VERTEXAI_BASE_URL` | Google Gemini TTS on Google Cloud Vertex AI's Interactions API: a service account (no API key), the project (default: the service account's), the location (default `global`), and an optional relay. |
| `GEMINI_TTS_MODEL`, `GEMINI_TTS_VOICE_ID`, `GEMINI_TTS_FORMAT`, `GEMINI_TTS_MP3_BITRATE_KBPS`, `GEMINI_TTS_SYNTHESIS_TIMEOUT_MS` | Voice, output, and timeout. |

## Models, search, documents

| Variable | Meaning |
| --- | --- |
| `OPENAI_API_KEY`, `OPENAI_API_BASE` | OpenAI-compatible API used by the extraction, vision, image, and prompt commands. |
| `OPENAI_MODEL`, `OPENAI_VISION_MODEL`, `OPENAI_IMAGE_MODEL`, `OPENAI_PROMPT_OPTIMIZE_MODEL`, `OPENAI_DESIGN_TEMPLATE_EXTRACT_MODEL`, `OPENAI_CONTENT_TEMPLATE_EXTRACT_MODEL` | Model per task. |
| `TAVILY_API_KEY` | Web search (local runtime). |
| `AINOBI_DOC_READ_MAX_BYTES` | Size limit of documents and images read by `doc` / `image`. |
| `PDFTOPPM_PATH` | `pdftoppm` binary for rendering PDF pages (default: on `PATH`). |

## Proxies

`HTTPS_PROXY` / `HTTP_PROXY` apply to outbound calls; `OSS_PROXY` / `OSS_PROXY_URL` to OSS, and `FISH_AUDIO_TTS_PROXY` / `FISH_AUDIO_PROXY`, `MINIMAX_TTS_PROXY` / `MINIMAX_PROXY`, `GEMINI_TTS_PROXY` to the respective TTS vendor.
