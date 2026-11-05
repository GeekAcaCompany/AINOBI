// SPDX-License-Identifier: AGPL-3.0-only
import { flagNumber, flagString, type ParsedArgs } from "../args.ts";
import { AinobiCliError } from "../errors.ts";
import { applyOperation, findSlideIndexInJson } from "../operations.ts";
import { printSuccess, type OutputOptions } from "../output.ts";
import { requireScene } from "../state.ts";
import { withSceneTransaction } from "../transaction.ts";
import { serializeScene } from "@ainobi/courseware-core/scene.ts";
import {
  getSlideLocalDurationMs,
  normalizeSlideFlowPausePoints,
} from "@ainobi/courseware-core/slide-flow-pause.ts";

const parseWhen = (args: ParsedArgs): "start" | "end" => {
  const raw = (flagString(args, "when") ?? "end").trim().toLowerCase();
  if (raw === "end") return "end";
  if (raw === "start") return "start";
  throw new AinobiCliError("INVALID_INPUT", 'flow-pause add: --when must be "start" or "end".');
};

export const handleFlowPauseAdd = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  await withSceneTransaction(args, output, (sceneJson) => {
    const result = applyOperation(sceneJson, {
      op: "flow_pause.add",
      slide: args.positionals[0],
      at: flagNumber(args, "at") ?? undefined,
      element: args.positionals[1] ?? flagString(args, "element") ?? undefined,
      when: parseWhen(args),
    });
    return result.data;
  });
};

export const handleFlowPauseRemove = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  await withSceneTransaction(args, output, (sceneJson) => {
    const result = applyOperation(sceneJson, {
      op: "flow_pause.remove",
      slide: args.positionals[0],
      pause_id: args.positionals[1],
    });
    return result.data;
  });
};

export const handleFlowPauseList = (args: ParsedArgs, output: OutputOptions): void => {
  const { scene } = requireScene();
  const sceneJson = serializeScene(scene) as Record<string, unknown>;
  const slideIndex = findSlideIndexInJson(sceneJson, args.positionals[0] ?? "");
  const slide = scene.slide_elements[slideIndex];
  if (!slide) {
    throw new AinobiCliError("NOT_FOUND", `Slide not found: ${args.positionals[0] ?? ""}`);
  }
  const slideDur = getSlideLocalDurationMs(slide);
  const points = normalizeSlideFlowPausePoints(slide.flow_pause_points, slideDur);
  printSuccess(
    {
      slide_index: slideIndex,
      element_id: slide.element_id,
      slide_duration_ms: slideDur,
      flow_pause_points: points,
      count: points.length,
    },
    output,
  );
};
