// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The multimodally verified Inochi2D teacher generation pipeline (public entry point).
 */

export { generateAvatarModel, type AvatarModelResult, type PipelineClients } from "./pipeline.ts";
export { AvatarPipelineError } from "./errors.ts";
export {
  AgentAnswerError,
  AgentModelBridge,
  AGENT_PIPELINE_SETTINGS,
  agentPipelineClients,
  type AgentAnswer,
  type AgentRequest,
} from "./agent_bridge.ts";
export { avatarApiKeyFromEnv, type AvatarApiClient, type AvatarPipelineSettings } from "./config.ts";
