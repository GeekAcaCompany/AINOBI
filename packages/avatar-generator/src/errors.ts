// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Fail-closed errors of the avatar pipeline.
 *
 * "Content failed acceptance" failures such as semantic gate rejections, failed matting metrics and exhausted image API retries
 * all use this type; the upper layer translates it into user-facing visual QA failure text,
 * and every other exception is treated as a system fault.
 */

export class AvatarPipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvatarPipelineError";
  }
}
