// SPDX-License-Identifier: AGPL-3.0-only
import { AinobiCliError } from "./errors.ts";
import { cliEnv } from "./env.ts";
import { hasSession } from "./state.ts";

/**
 * Host-injected mode for ainobi-cli. The AINOBI courseware agent service sets
 * `AINOBI_CLI_RUNTIME=agent` so `ainobi save` persists via the host HTTP API
 * instead of writing local scene JSON files.
 */
export const isAgentCliRuntime = (): boolean =>
  cliEnv().AINOBI_CLI_RUNTIME?.trim().toLowerCase() === "agent";

/** Host persists via PostToolUse; CLI must not PUT to localhost from the sandbox. */
export const isPersistenceHostFlush = (): boolean =>
  isAgentCliRuntime() && cliEnv().AINOBI_PERSISTENCE_HOST_FLUSH?.trim() === "1";

/** TTS synthesis + OSS upload run on the AINOBI host; sandbox CLI delegates via HTTP. */
export const isNarrationHostFlush = (): boolean =>
  isAgentCliRuntime() && cliEnv().AINOBI_NARRATION_HOST_FLUSH?.trim() === "1";

/** Tavily web search runs on the AINOBI host; sandbox CLI POSTs to the search host URL. */
export const isSearchHostFlush = (): boolean =>
  isAgentCliRuntime() && cliEnv().AINOBI_SEARCH_HOST_FLUSH?.trim() === "1";

/** Document→markdown conversion runs on the AINOBI host (markitdown-ts + OpenAI vision). */
export const isDocHostFlush = (): boolean =>
  isAgentCliRuntime() && cliEnv().AINOBI_DOC_HOST_FLUSH?.trim() === "1";

/** Image→HTML vision replication runs on the AINOBI host (OpenAI-compatible multimodal API). */
export const isImageReplicateHostFlush = (): boolean =>
  isAgentCliRuntime() && cliEnv().AINOBI_IMAGE_REPLICATE_HOST_FLUSH?.trim() === "1";

/** Text→image generation runs on the AINOBI host (OpenAI Images API + OSS asset persistence). */
export const isImageGenerateHostFlush = (): boolean =>
  isAgentCliRuntime() && cliEnv().AINOBI_IMAGE_GENERATE_HOST_FLUSH?.trim() === "1";

/** Organization AI teacher catalog is fetched on the AINOBI host; sandbox CLI POSTs to the list URL. */
export const isAiTeachersHostFlush = (): boolean =>
  isAgentCliRuntime() && cliEnv().AINOBI_AI_TEACHERS_HOST_FLUSH?.trim() === "1";

/** Platform TTS catalog is fetched on the AINOBI host; sandbox CLI POSTs to the list URL. */
export const isTtsHostFlush = (): boolean =>
  isAgentCliRuntime() && cliEnv().AINOBI_TTS_HOST_FLUSH?.trim() === "1";

/** Org design template CRUD/extract runs on the AINOBI host. */
export const isDesignTemplateHostFlush = (): boolean =>
  isAgentCliRuntime() && cliEnv().AINOBI_DESIGN_TEMPLATE_HOST_FLUSH?.trim() === "1";

/** Org content template CRUD/extract runs on the AINOBI host. */
export const isContentTemplateHostFlush = (): boolean =>
  isAgentCliRuntime() && cliEnv().AINOBI_CONTENT_TEMPLATE_HOST_FLUSH?.trim() === "1";

/** OSS upload + courseware_assets DB rows run on the AINOBI host HTTP API. */
export const isAssetHostFlush = (): boolean =>
  isAgentCliRuntime() && cliEnv().AINOBI_ASSET_HOST_FLUSH?.trim() === "1";

/** Block a second `load`/`init` while the host-bound agent chat already has a scene. */
export const rejectAgentSceneRebootstrap = (): void => {
  if (!isAgentCliRuntime() || !hasSession()) {
    return;
  }
  throw new AinobiCliError(
    "INVALID_INPUT",
    "A courseware scene is already loaded for this agent chat.",
    {
      hint:
        "Use `ainobi status`, `ainobi scene info --verbose`, or `ainobi slide list --verbose`. " +
        "Do not run `ainobi load` or `ainobi init` again unless the user explicitly asks to discard the current scene; run `ainobi reset` first.",
    },
  );
};

export const workDirCleanupInstruction = (): string => {
  if (isAgentCliRuntime()) {
    return (
      "Use this directory for temporary helper payloads/assets for this courseware session. " +
      "In agent runtime (`AINOBI_CLI_RUNTIME=agent`), run `ainobi save` (no path) to persist through the host; " +
      "the managed work_dir is cleaned after a successful save."
    );
  }
  return (
    "Use this directory for temporary helper payloads/assets for this courseware session. " +
    "It is cleaned automatically after `ainobi save` succeeds."
  );
};
