// SPDX-License-Identifier: AGPL-3.0-only
import { prepareSceneAssetUrlsForPersistence } from "@ainobi/courseware-core/presign-scene.ts";
import { deserializeScene, serializeScene } from "@ainobi/courseware-core/scene.ts";
import { normalizeCoursewareAssetUrlForPersistence } from "./asset-url-persistence.ts";

/** Normalize scene JSON before DB save or live-preview diff (host-side; independent of `ainobi save`). */
export const normalizeSceneJsonForPersistence = (input: unknown): unknown => {
  try {
    const scene = deserializeScene(input);
    return serializeScene(prepareSceneAssetUrlsForPersistence(scene, normalizeCoursewareAssetUrlForPersistence));
  } catch {
    return input;
  }
};

const normalizePatchLeaf = (value: unknown): unknown => {
  if (typeof value === "string") {
    return normalizeCoursewareAssetUrlForPersistence(value);
  }
  if (Array.isArray(value)) {
    return value.map(normalizePatchLeaf);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = normalizePatchLeaf(nested);
    }
    return out;
  }
  return value;
};

/** Normalize asset URLs inside RFC 6902 patch ops sent to the editor. */
export const normalizeScenePatchForPersistence = (
  patch: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> =>
  patch.map((op) => {
    if (!("value" in op)) return op;
    const normalized = normalizePatchLeaf(op.value);
    if (normalized === op.value) return op;
    return { ...op, value: normalized };
  });
