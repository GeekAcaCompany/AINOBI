// SPDX-License-Identifier: AGPL-3.0-only
import type { SlideElement, VtuberElement } from "@ainobi/courseware-core/elements.ts";
import { listVtubersOnSlide } from "@ainobi/courseware-core/slide-stack.ts";
import { getAiTeacherIdFromVtuberMetadata } from "@ainobi/avatar/vtuber-model-defaults";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readVtuberAiTeacherId(vtuber: VtuberElement): string {
  const fromMetadata = getAiTeacherIdFromVtuberMetadata(
    (vtuber.metadata ?? {}) as Record<string, unknown>,
  );
  if (fromMetadata) return fromMetadata;
  const modelId = vtuber.model_id?.trim() ?? "";
  // On AI teacher vtubers model_id usually equals ai_teacher_id; generic model ids aren't UUIDs, so lookups aren't triggered by mistake.
  if (modelId && UUID_RE.test(modelId)) return modelId;
  return "";
}

function pickFirstAiTeacherId(vtubers: readonly VtuberElement[]): string | null {
  for (const vtuber of vtubers) {
    const id = readVtuberAiTeacherId(vtuber);
    if (id) return id;
  }
  return null;
}

/**
 * Resolve the AI teacher ID from the courseware scene: the current slide's vtuber first, then the scene-level vtuber, then the other slides.
 * With several vtubers the first valid `ai_teacher_id` is taken.
 */
export function resolveSceneAiTeacherId(args: {
  currentSlide: SlideElement | null | undefined;
  sceneVtubers?: readonly VtuberElement[];
  allSlides?: readonly SlideElement[];
}): string | null {
  if (args.currentSlide) {
    const fromCurrent = pickFirstAiTeacherId(listVtubersOnSlide(args.currentSlide));
    if (fromCurrent) return fromCurrent;
  }

  const fromScene = pickFirstAiTeacherId(args.sceneVtubers ?? []);
  if (fromScene) return fromScene;

  for (const slide of args.allSlides ?? []) {
    if (slide === args.currentSlide) continue;
    const id = pickFirstAiTeacherId(listVtubersOnSlide(slide));
    if (id) return id;
  }

  return null;
}
