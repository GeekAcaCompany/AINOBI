// SPDX-License-Identifier: AGPL-3.0-only
/** AI teacher related URL keys in metadata subject to presign / persistence normalization. */
export const AI_TEACHER_ASSET_METADATA_URL_KEYS = [
  "model_url",
  "ai_teacher_live2d_model_url",
  "ai_teacher_live2d_model_image_url",
  "ai_teacher_avatar_url",
] as const;

export const stripAITeacherAssetUrlsFromMetadata = (
  metadata: Record<string, unknown>,
  normalize: (url: string) => string,
): Record<string, unknown> => {
  let next = metadata;
  for (const key of AI_TEACHER_ASSET_METADATA_URL_KEYS) {
    const value = metadata[key];
    if (typeof value !== "string" || !value) continue;
    const normalized = normalize(value);
    if (normalized === value) continue;
    if (next === metadata) next = { ...metadata };
    next[key] = normalized;
  }
  return next;
};
