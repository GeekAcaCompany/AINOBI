// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Allowlisted environment for Claude Agent SDK subprocesses — the mechanism is in @ainobi/agent-runtime;
 * this file is the courseware agent's key policy.
 * Anthropic credentials / model / base URL are assigned in `chat-http` `buildClaudeEnv`
 * (not inherited from host). OSS / MiniMax stay on the host narration worker.
 */

import {
  AGENT_BASE_INHERIT_KEYS,
  AGENT_BASE_INJECT_KEYS,
  createAgentSubprocessEnvPicker,
} from "@ainobi/agent-runtime";

export { AGENT_DEFAULT_UTF8_LOCALE } from "@ainobi/agent-runtime";

export const pickAgentSubprocessEnv = createAgentSubprocessEnvPicker({
  hostEnv: () => process.env,
  inheritKeys: [
    ...AGENT_BASE_INHERIT_KEYS,
    // ★Storage credentials (STORAGE_BACKEND/OCI_S3_*/OSS_*) are deliberately not handed down — the subprocess only needs the
    // URL allowlist, derived by the host and passed through AINOBI_COURSEWARE_ASSET_BASE_URLS (a host key).
    // Credentials in the subprocess would let the LLM's bash tool read the platform storage write credentials (a security test anchor).
    "AINOBI_COURSEWARE_ASSET_BASE_URLS",
    // A host's own default teacher (Studio's built-in one), for elements that name none.
    "AINOBI_DEFAULT_AI_TEACHER_ID",
    "AINOBI_DEFAULT_AI_TEACHER_NAME",
    "AINOBI_DEFAULT_AI_TEACHER_MODEL_URL",
    "AINOBI_DEFAULT_AI_TEACHER_AVATAR_URL",
  ],
  injectKeys: AGENT_BASE_INJECT_KEYS,
  /** Host-injected courseware / asset / persistence URLs (set on agent `env` after `buildClaudeEnv`). */
  hostKeys: [
    "AINOBI_COURSEWARE_KEY",
    "AINOBI_COURSEWARE_ID",
    "AINOBI_COURSEWARE_ORG_ID",
    "AINOBI_COURSEWARE_PERSISTENCE_URL",
    "AINOBI_COURSEWARE_ASSET_UPLOAD_URL",
    "AINOBI_COURSEWARE_ASSET_GET_URL",
    "AINOBI_PERSISTENCE_HOST_FLUSH",
    "AINOBI_NARRATION_HOST_FLUSH",
    "AINOBI_NARRATION_HOST_URL",
    "AINOBI_SEARCH_HOST_FLUSH",
    "AINOBI_SEARCH_HOST_URL",
    "AINOBI_DOC_HOST_FLUSH",
    "AINOBI_DOC_HOST_URL",
    "AINOBI_KNOWLEDGE_HOST_URL",
    "AINOBI_IMAGE_REPLICATE_HOST_FLUSH",
    "AINOBI_IMAGE_REPLICATE_HOST_URL",
    "AINOBI_IMAGE_GENERATE_HOST_FLUSH",
    "AINOBI_IMAGE_GENERATE_HOST_URL",
    "AINOBI_AI_TEACHERS_HOST_FLUSH",
    "AINOBI_AI_TEACHERS_HOST_URL",
    "AINOBI_TTS_HOST_FLUSH",
    "AINOBI_TTS_HOST_URL",
    "AINOBI_DESIGN_TEMPLATE_HOST_FLUSH",
    "AINOBI_DESIGN_TEMPLATE_HOST_BASE",
    "AINOBI_ASSET_HOST_FLUSH",
    "AINOBI_LIVE_PREVIEW_HOST_FLUSH",
    "AINOBI_STATE_DIR",
    "AINOBI_WORK_DIR",
    "AINOBI_CONVERSATION_ID",
    "AINOBI_CLAUDE_SESSION_ID",
    "AINOBI_TOOL_RESULT_RECALL_HOST_URL",
    "AINOBI_AGENT_NOW_ISO",
    "AINOBI_AGENT_TIMEZONE",
    "AINOBI_AGENT_NOW_LOCAL",
    "AINOBI_COURSEWARE_ASSET_BASE_URLS",
  ],
  utf8LocaleFallback: true,
});
