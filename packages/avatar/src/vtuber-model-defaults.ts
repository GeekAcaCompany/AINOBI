// SPDX-License-Identifier: AGPL-3.0-only
import type { Element } from "@ainobi/courseware-core/elements.ts";
import { aiTeacherDefaultModelUrl, defaultModelUrl } from "./host.ts";

// The default models are host settings (configureAvatar): defaultModelUrl for an avatar that names no model, and
// aiTeacherDefaultModelUrl for an AI teacher without one of its own.

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
    return aiTeacherDefaultModelUrl();
  }
  return defaultModelUrl();
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

  const modelUrl = aiTeacherDefaultModelUrl();
  if (!modelUrl) return metadata;
  return {
    ...metadata,
    model_url: modelUrl,
    ai_teacher_live2d_model_url: modelUrl,
    runtime: isInochiModelUrl(modelUrl) ? "inochi2d" : "live2d",
  };
}
