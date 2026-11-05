// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The multimodally verified Inochi2D teacher generation pipeline (public entry point).
 */

export { generateAvatarModel, type AvatarModelResult, type PipelineClients } from "./pipeline.ts";
export { AvatarPipelineError } from "./errors.ts";
export type { AvatarApiClient, AvatarPipelineSettings } from "./config.ts";
