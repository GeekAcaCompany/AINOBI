// SPDX-License-Identifier: AGPL-3.0-only
import { resolve } from "node:path";

import type { Scene, SlideElement } from "@ainobi/courseware-core";
import { flagString, type ParsedArgs } from "./args.ts";
import { AinobiCliError } from "./errors.ts";
import { readJsonFile } from "./input.ts";
import { parseScene } from "./validate.ts";

export function resolveReferenceScenePath(args: ParsedArgs, index = 0): string {
  const positional = args.positionals[index]?.trim();
  const fileFlag = flagString(args, "file")?.trim();
  const path = fileFlag || positional;
  if (!path) {
    throw new AinobiCliError(
      "USAGE",
      "Specify a staged reference `.scene.json` path.",
      {
        hint:
          "Example: `ainobi reference slide list ./reference/AWS入门课程1-80591c07.scene.json`. Use `.brief.json` only with `reference inspect`.",
      },
    );
  }
  const resolved = resolve(path);
  if (resolved.toLowerCase().endsWith(".brief.json")) {
    throw new AinobiCliError(
      "USAGE",
      "Fine-grained reference commands require the full `.scene.json` file.",
      {
        hint: resolved.replace(/\.brief\.json$/i, ".scene.json"),
      },
    );
  }
  return resolved;
}

export function loadReferenceScene(path: string): Scene {
  const raw = readJsonFile(path);
  const { scene } = parseScene(raw, { allowSkip: true });
  return scene;
}

export const referenceSlideSummary = (slide: SlideElement, index: number) => ({
  index,
  element_id: slide.element_id,
  name: slide.name,
  background_color: slide.background_color,
  size: slide.size,
  timeline: slide.timeline,
  z_index: slide.style.z_index,
  children_count: slide.children_elements.length,
});

export const referenceSceneSummary = (scene: Scene) => ({
  scene_id: scene.scene_id,
  name: scene.name,
  slide_count: scene.slide_elements.length,
  vtuber_count: scene.vtuber_elements.length,
  has_quiz: !!scene.quiz,
});
