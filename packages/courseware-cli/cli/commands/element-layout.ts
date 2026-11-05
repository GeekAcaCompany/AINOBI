// SPDX-License-Identifier: AGPL-3.0-only
import { flagBool, flagNumber, flagString, type ParsedArgs } from "../args.ts";
import { AinobiCliError } from "../errors.ts";
import { applyOperation } from "../operations.ts";
import type { OutputOptions } from "../output.ts";
import { withSceneTransaction } from "../transaction.ts";

const idsFlag = (args: ParsedArgs): string => {
  const ids = flagString(args, "ids") ?? flagString(args, "id");
  if (!ids?.trim()) {
    throw new AinobiCliError("USAGE", "Provide --ids <id1,id2,...>.");
  }
  return ids;
};

export const handleElementAlign = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  await withSceneTransaction(args, output, (sceneJson) => {
    const result = applyOperation(sceneJson, {
      op: "element.align",
      slide: args.positionals[0],
      ids: idsFlag(args),
      mode: flagString(args, "mode") ?? "center-x",
    });
    return result.data;
  });
};

export const handleElementDistribute = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  await withSceneTransaction(args, output, (sceneJson) => {
    const result = applyOperation(sceneJson, {
      op: "element.distribute",
      slide: args.positionals[0],
      ids: idsFlag(args),
      axis: flagString(args, "axis") ?? "x",
      gap: flagNumber(args, "gap") ?? 24,
    });
    return result.data;
  });
};

export const handleElementLayer = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  await withSceneTransaction(args, output, (sceneJson) => {
    const result = applyOperation(sceneJson, {
      op: "element.layer",
      slide: args.positionals[0],
      element: args.positionals[1],
      front: flagBool(args, "front", false),
      back: flagBool(args, "back", false),
      z: flagNumber(args, "z") ?? flagNumber(args, "z-index"),
    });
    return result.data;
  });
};

