// SPDX-License-Identifier: AGPL-3.0-only
import { flagBool, flagString, type ParsedArgs } from "../args.ts";
import { AinobiCliError } from "../errors.ts";
import { resolveJsonInput } from "../input.ts";
import { rejectInvalidContentLanguagePatch } from "../mutation-guards.ts";
import { buildPatchFromSetEntries, deepMerge } from "../patch.ts";
import { saveScene, requireScene } from "../state.ts";
import { parseScene } from "../validate.ts";
import { printSuccess, type OutputOptions } from "../output.ts";
import { serializeScene } from "@ainobi/courseware-core";

const sceneSummary = (scene: ReturnType<typeof parseScene>["scene"]) => ({
  scene_id: scene.scene_id,
  name: scene.name,
  slide_count: scene.slide_elements.length,
  vtuber_count: scene.vtuber_elements.length,
  transitions: scene.transitions,
  has_quiz: !!scene.quiz,
});

export const handleSceneInfo = (args: ParsedArgs, output: OutputOptions): void => {
  const { session, scene } = requireScene();
  const verbose = flagBool(args, "verbose", false);
  if (verbose) {
    printSuccess(
      {
        ...sceneSummary(scene),
        session_id: session.session_id,
        work_dir: session.work_dir ?? null,
        source_path: session.source_path,
        controller: scene.controller,
        preset_script: scene.preset_script,
        metadata: scene.metadata,
        slides: scene.slide_elements.map((slide, index) => ({
          index,
          element_id: slide.element_id,
          name: slide.name,
        })),
      },
      output,
    );
    return;
  }
  printSuccess(sceneSummary(scene), output);
};

const FORBIDDEN_SCENE_FIELDS = new Set([
  "scene_id",
  "slide_elements",
  "vtuber_elements",
  "quiz",
]);

export const handleSceneUpdate = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  const { session, scene } = requireScene();
  const json = resolveJsonInput(args);
  const setEntries = args.multi.set ?? [];
  if (!json && setEntries.length === 0 && flagString(args, "name") === undefined) {
    throw new AinobiCliError(
      "USAGE",
      "Provide at least one update via --json, --set, or --name.",
    );
  }
  let patch: Record<string, unknown> = {};
  if (json) {
    if (typeof json !== "object" || json === null || Array.isArray(json)) {
      throw new AinobiCliError("INVALID_INPUT", "--json must be an object for scene update.");
    }
    patch = { ...(json as Record<string, unknown>) };
  }
  if (setEntries.length > 0) {
    patch = deepMerge(patch, buildPatchFromSetEntries(setEntries));
  }
  const nameFlag = flagString(args, "name");
  if (nameFlag !== undefined) patch.name = nameFlag;

  for (const key of Object.keys(patch)) {
    if (FORBIDDEN_SCENE_FIELDS.has(key)) {
      throw new AinobiCliError(
        "INVALID_INPUT",
        `Field "${key}" cannot be updated via \`scene update\`.`,
        {
          hint:
            "Slides/vtuber/quiz are managed by their dedicated commands. scene_id is immutable.",
        },
      );
    }
  }

  rejectInvalidContentLanguagePatch(patch, "scene update");

  const merged = deepMerge(serializeScene(scene) as Record<string, unknown>, patch);
  const { scene: validated, warnings } = parseScene(merged);
  await saveScene(session, validated);
  printSuccess(
    {
      updated_fields: Object.keys(patch),
      scene: sceneSummary(validated),
    },
    output,
    warnings.length > 0 ? warnings : undefined,
  );
};
