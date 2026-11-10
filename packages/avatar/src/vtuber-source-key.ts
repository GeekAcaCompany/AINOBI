// SPDX-License-Identifier: AGPL-3.0-only
import { stripCoursewareAssetSignatureFromUrl } from "@ainobi/courseware-core";
import type { SlideElement, VtuberElement } from "@ainobi/courseware-core/elements.ts";
import { listVtubersOnSlide } from "@ainobi/courseware-core/slide-stack.ts";
import { getVtuberModelUrlFromMetadata } from "./vtuber-model-defaults.ts";

/**
 * Stable key for reusing the same model runtime across slides and element ids.
 * Strips presigned query params so URL-only signature churn does not spawn a second instance.
 */
/** Editor thumbnail / minimap: only use snapshot for the current model source key. */
export function resolveVtuberEditorSnapshot(
  element: VtuberElement,
  bySourceKey: Record<string, string>,
): string | undefined {
  const sourceKey = getVtuberSourceKey(element);
  return bySourceKey[sourceKey];
}

export function getVtuberSourceKey(element: VtuberElement): string {
  const metadata = element.metadata as Record<string, unknown>;
  const modelUrl = stripCoursewareAssetSignatureFromUrl(
    getVtuberModelUrlFromMetadata(metadata),
  );
  if (modelUrl) return `model:${modelUrl}`;
  if (element.model_id.trim()) return `model-id:${element.model_id.trim()}`;
  const teacherId = metadata.ai_teacher_id;
  return typeof teacherId === "string" && teacherId.trim()
    ? `teacher:${teacherId.trim()}`
    : "model:default";
}

/** Merge the lip values of each slide's element_id under the same model source (narration may bind another slide's vtuber id). */
export function resolveVtuberLipSyncValue(
  sourceKey: string,
  primaryElementId: string,
  lipSyncByElementId: Record<string, number>,
  allSlides: SlideElement[],
): number {
  let peak = lipSyncByElementId[primaryElementId] ?? 0;
  if (peak > 0.001) return peak;
  for (const s of allSlides) {
    for (const v of listVtubersOnSlide(s)) {
      if (getVtuberSourceKey(v) !== sourceKey) continue;
      const val = lipSyncByElementId[v.element_id] ?? 0;
      if (val > peak) peak = val;
    }
  }
  return peak;
}
