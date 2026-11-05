// SPDX-License-Identifier: AGPL-3.0-only
/** Claude Code OS sandbox — the mechanism is in @ainobi/agent-runtime; this file binds the host environment and the reachable tool URL keys. */
import { createAgentSandbox } from "@ainobi/agent-runtime";

export const {
  shouldEnableWeakerNestedSandbox,
  isAgentSandboxDisabled,
  shouldUseOsSandbox,
  resolveBundledRgPath,
  resolveSandboxToolPaths,
  resolveClaudeSandboxHelperPaths,
  buildAgentSandboxSettings,
} = createAgentSandbox({
  hostEnv: () => process.env,
  hostUrlEnvKeys: [
    "ANTHROPIC_BASE_URL",
    "AINOBI_COURSEWARE_PERSISTENCE_URL",
    "AINOBI_COURSEWARE_ASSET_UPLOAD_URL",
    "AINOBI_COURSEWARE_ASSET_GET_URL",
    "AINOBI_NARRATION_HOST_URL",
    "AINOBI_SEARCH_HOST_URL",
    "AINOBI_DOC_HOST_URL",
    "AINOBI_AI_TEACHERS_HOST_URL",
    "AINOBI_TOOL_RESULT_RECALL_HOST_URL",
    "AINOBI_BACKEND_API_BASE",
  ],
});

/** @deprecated Use {@link shouldEnableWeakerNestedSandbox}. */
export const isWeakerNestedSandboxEnabled = shouldEnableWeakerNestedSandbox;
