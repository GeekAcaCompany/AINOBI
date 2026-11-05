// SPDX-License-Identifier: AGPL-3.0-only
import type { Element } from "@ainobi/courseware-core/elements.ts";

/**
 * AI teacher vtuber: the default Live2D when no model URL is set.
 * A bare storage key (the example-storage private bucket). Loading always goes through presign
 * (batch_presign_urls with a courseware context, publicOnlyMode without one).
 * The old value `https://courseware.example.com/model/...` was a direct public CDN link,
 * retired because it contradicts the "sign everything" policy after example-public was closed.
 */
export const DEFAULT_AI_TEACHER_LIVE2D_MODEL_URL =
  "model/live2d_model/ainobi-teacher-001/ainobi-teacher-001.model3.json";

export const DEFAULT_VTUBER_MODEL_URL = "/models/geekaca-teacher/geekaca-teacher.model3.json";

export const isInochiModelUrl = (url: string): boolean => /\.inx(?:[?#]|$)/i.test(url);

function readMetadataModelUrl(metadata: Record<string, unknown>): string {
  const modelUrl =
    typeof metadata.model_url === "string" ? metadata.model_url.trim() : "";
  const resolved = modelUrl || (
    typeof metadata.ai_teacher_live2d_model_url === "string"
      ? metadata.ai_teacher_live2d_model_url.trim()
      : ""
  );
  if (!resolved) return "";
  // Legacy scenes stored the Cubism settings as `.model3.js`; the object on
  // storage (and every backend default) is `.model3.json`. Alias it so the
  // presign key mapping and the loader's model3.json gate both recognize it —
  // otherwise the model silently never loads (spinner, no request).
  return resolved.replace(/\.model3\.js(?=[?#]|$)/i, ".model3.json");
}

export function getAiTeacherIdFromVtuberMetadata(
  metadata: Record<string, unknown>,
): string {
  const teacherId = metadata.ai_teacher_id;
  return typeof teacherId === "string" ? teacherId.trim() : "";
}

/** For edit/preview display: the model URL resolved from metadata */
export function getVtuberModelUrlFromMetadata(
  metadata: Record<string, unknown>,
): string {
  const explicit = readMetadataModelUrl(metadata);
  if (explicit) return explicit;
  if (getAiTeacherIdFromVtuberMetadata(metadata)) {
    return DEFAULT_AI_TEACHER_LIVE2D_MODEL_URL;
  }
  return DEFAULT_VTUBER_MODEL_URL;
}

/**
 * Before persisting: when a vtuber bound to an AI teacher has an empty model URL, write the default model key.
 */
export function normalizeVtuberMetadataForPersistence(
  metadata: Element["metadata"],
): Element["metadata"] {
  const meta = metadata as Record<string, unknown>;
  if (!getAiTeacherIdFromVtuberMetadata(meta)) return metadata;
  if (readMetadataModelUrl(meta)) return metadata;

  const live2dModelUrl = DEFAULT_AI_TEACHER_LIVE2D_MODEL_URL;
  return {
    ...metadata,
    model_url: live2dModelUrl,
    ai_teacher_live2d_model_url: live2dModelUrl,
    runtime: isInochiModelUrl(live2dModelUrl) ? "inochi2d" : "live2d",
  };
}
