// SPDX-License-Identifier: AGPL-3.0-only
import { flagBool, flagNumber, flagString, type ParsedArgs } from "../args.ts";
import { AinobiCliError } from "../errors.ts";
import { applyOperation } from "../operations.ts";
import type { OutputOptions } from "../output.ts";
import { withSceneTransaction } from "../transaction.ts";

const timelineStart = (args: ParsedArgs): number =>
  flagNumber(args, "start") ?? flagNumber(args, "from") ?? 0;

export const handleAnimationPreset = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  await withSceneTransaction(args, output, (sceneJson) => {
    const result = applyOperation(sceneJson, {
      op: "animation.preset",
      slide: args.positionals[0],
      element: args.positionals[1],
      kind: flagString(args, "kind") ?? "fade-in",
      from: timelineStart(args),
      to: flagNumber(args, "to") ?? undefined,
    });
    return result.data;
  });
};

export const handleAnimationStagger = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  const ids = flagString(args, "ids");
  if (!ids?.trim()) throw new AinobiCliError("USAGE", "Provide --ids <id1,id2,...>.");
  await withSceneTransaction(args, output, (sceneJson) => {
    const result = applyOperation(sceneJson, {
      op: "animation.stagger",
      slide: args.positionals[0],
      ids,
      kind: flagString(args, "kind") ?? "fade-up",
      from: timelineStart(args),
      duration: flagNumber(args, "duration") ?? 800,
      gap: flagNumber(args, "gap") ?? 200,
    });
    return result.data;
  });
};

export const handleAnimationTimeline = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  await withSceneTransaction(args, output, (sceneJson) => {
    const result = applyOperation(sceneJson, {
      op: "animation.timeline",
      slide: args.positionals[0],
      duration: flagNumber(args, "duration") ?? flagNumber(args, "duration-ms"),
      fit_elements: flagBool(args, "fit-elements", false),
    });
    return result.data;
  });
};

export const handleHighlightAdd = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  await withSceneTransaction(args, output, (sceneJson) => {
    const result = applyOperation(sceneJson, {
      op: "highlight.add",
      slide: args.positionals[0],
      element: args.positionals[1],
      from: flagNumber(args, "from"),
      to: flagNumber(args, "to"),
      padding: flagNumber(args, "padding") ?? undefined,
      radius: flagNumber(args, "radius") ?? undefined,
      color: flagString(args, "color") ?? undefined,
      opacity: flagNumber(args, "opacity") ?? undefined,
    });
    return result.data;
  });
};

