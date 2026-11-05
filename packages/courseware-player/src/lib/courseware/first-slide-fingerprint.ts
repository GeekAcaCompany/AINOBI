// SPDX-License-Identifier: AGPL-3.0-only
import { normalizeElementForSerialization, type SlideElement } from "@ainobi/courseware-core/elements.ts";
import type { Scene } from "@ainobi/courseware-core/scene.ts";

/** Fingerprint of the first slide by the persistence rule, used to decide whether the cover needs regenerating. */
export const computeFirstSlideFingerprint = (slide: SlideElement | undefined): string => {
  if (!slide) return "";
  return JSON.stringify(normalizeElementForSerialization(slide));
};

export const computeFirstSlideFingerprintFromScene = (scene: Scene): string =>
  computeFirstSlideFingerprint(scene.slide_elements[0]);

export const hasFirstSlideChanged = (
  scene: Scene,
  previousFingerprint: string | null | undefined,
): boolean => {
  const next = computeFirstSlideFingerprintFromScene(scene);
  if (!next) return false;
  if (!previousFingerprint) return true;
  return next !== previousFingerprint;
};

/**
 * A cover needs generating when the first slide changed relative to "the last cover upload", or the server has no cover yet.
 * `lastCoverUploadedFingerprint` is separate from the save fingerprint, so a successful save isn't misjudged as unchanged.
 */
export const shouldRefreshCoursewareCover = (
  scene: Scene,
  lastCoverUploadedFingerprint: string | null | undefined,
  serverCoverUrl: string | null | undefined,
): boolean => {
  if (hasFirstSlideChanged(scene, lastCoverUploadedFingerprint)) return true;
  return !serverCoverUrl?.trim();
};
