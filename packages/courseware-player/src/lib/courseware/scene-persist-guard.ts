// SPDX-License-Identifier: AGPL-3.0-only
import type { SlideElement } from "@ainobi/courseware-core/elements.ts";
import type { Scene } from "@ainobi/courseware-core/scene.ts";

function slideHasPersistableContent(slide: SlideElement): boolean {
  if (slide.children_elements.length > 0) return true;
  if (slide.background_image_url?.trim()) return true;
  if ((slide.flow_pause_points?.length ?? 0) > 0) return true;
  return false;
}

/**
 * True when the scene has no persistable courseware content (empty slides, or slides
 * with no children and no global vtuber / audio / quiz). Used to block remote PUT so
 * a failed local load cannot wipe server courseware.
 */
export function isCoursewareSceneEffectivelyEmpty(scene: Scene): boolean {
  if (scene.slide_elements.length === 0) return true;

  for (const slide of scene.slide_elements) {
    if (slideHasPersistableContent(slide)) return false;
  }

  if (scene.vtuber_elements.length > 0) return false;
  if (scene.audio_elements.length > 0) return false;
  if (scene.quiz?.questions?.length) return false;

  return true;
}
