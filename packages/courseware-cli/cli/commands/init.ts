// SPDX-License-Identifier: AGPL-3.0-only
import { flagBool, flagNumber, flagString, type ParsedArgs } from "../args.ts";
import { AinobiCliError } from "../errors.ts";
import { assertNoNewReplacementChars } from "../replacement-char-guard.ts";
import { newElementId, newSceneId } from "../ids.ts";
import { printSuccess, type OutputOptions } from "../output.ts";
import { rejectAgentSceneRebootstrap, workDirCleanupInstruction } from "../runtime.ts";
import {
  createBoundSessionId,
  createSessionWorkDir,
  saveSessionRecord,
  stateFilePath,
} from "../state.ts";
import { parseScene } from "../validate.ts";
import { serializeScene } from "@ainobi/courseware-core";
import { CONTENT_LANGUAGES, isContentLanguage } from "@ainobi/courseware-core/content-language.ts";

const controllerDefaults = {
  play: true,
  next: true,
  back: true,
  seekBar: true,
  time: true,
  slideNumber: true,
  volume: true,
  fullScreen: true,
  brand: true,
  playbackRate: true,
};

export const handleInit = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  rejectAgentSceneRebootstrap();

  const name = flagString(args, "name") ?? "Untitled Courseware";
  // Required: the courseware content language must be confirmed with the user, never inferred.
  const language = flagString(args, "language");
  if (!isContentLanguage(language)) {
    throw new AinobiCliError(
      "USAGE",
      `--language <${CONTENT_LANGUAGES.join("|")}> is required. Confirm the courseware language with the user before running ainobi init.`,
    );
  }
  const width = flagNumber(args, "width") ?? 1920;
  const height = flagNumber(args, "height") ?? 1080;
  const theme = flagString(args, "theme") ?? "default";
  const withFirstSlide = flagBool(args, "first-slide", false);
  const duration = flagNumber(args, "duration") ?? 10000;
  const background = flagString(args, "background") ?? (theme === "dark" ? "#0F172A" : "#FFFFFF");
  const sceneJson: Record<string, unknown> = {
    scene_id: newSceneId(),
    name,
    slide_elements: [],
    vtuber_elements: [],
    audio_elements: [],
    controller: controllerDefaults,
    transitions: [],
    preset_script: "",
    metadata: {
      theme,
      canvas: { width, height },
      language,
      generated_by: "ainobi-cli",
    },
  };
  if (withFirstSlide) {
    sceneJson.slide_elements = [
      {
        element_type: "slide",
        element_id: newElementId("slide"),
        // Intentionally unnamed: the student editor renders a localized page
        // label for empty slide names instead of a hardcoded Chinese placeholder.
        name: "",
        action_mappings: {},
        event_scripts: {},
        preset_script: "",
        position: { x: 0, y: 0 },
        size: { width, height },
        timeline: { start_at: 0, end_at: duration },
        style: { opacity: 1, rotation_deg: 0, z_index: 0 },
        enter_effect: "none",
        exit_effect: "none",
        animations: [],
        keyframes: [],
        event_bindings: [],
        fps: 30,
        metadata: {},
        background_color: background,
        background_image_url: "",
        background_image_fit: "cover",
        children_elements: [],
      },
    ];
  }
  const { scene, warnings } = parseScene(sceneJson);
  const serialized = serializeScene(scene);
  assertNoNewReplacementChars(null, serialized);
  const sessionId = createBoundSessionId();
  const workDir = createSessionWorkDir(sessionId);
  const session = {
    session_id: sessionId,
    source_path: null,
    loaded_at: new Date().toISOString(),
    saved_at: null,
    dirty: true,
    work_dir: workDir,
    scene: serialized,
  };
  saveSessionRecord(session);
  printSuccess(
    {
      session_id: sessionId,
      state_file: stateFilePath(sessionId),
      work_dir: workDir,
      work_dir_instruction: workDirCleanupInstruction(),
      scene: {
        scene_id: scene.scene_id,
        name: scene.name,
        slide_count: scene.slide_elements.length,
        metadata: scene.metadata,
      },
    },
    output,
    warnings,
  );
};

