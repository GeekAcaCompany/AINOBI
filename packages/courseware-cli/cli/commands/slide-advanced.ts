// SPDX-License-Identifier: AGPL-3.0-only
import { flagNumber, flagString, type ParsedArgs } from "../args.ts";
import { applyOperation } from "../operations.ts";
import type { OutputOptions } from "../output.ts";
import { withSceneTransaction } from "../transaction.ts";

export const handleSlideTemplate = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  const kind = args.positionals[0] ?? flagString(args, "kind") ?? "hero";
  await withSceneTransaction(args, output, (sceneJson) => {
    const result = applyOperation(sceneJson, {
      op: "slide.template",
      kind,
      title: flagString(args, "title") ?? flagString(args, "name") ?? "",
      subtitle: flagString(args, "subtitle") ?? "",
      visual: flagString(args, "visual") ?? "",
      background: flagString(args, "background") ?? undefined,
      duration: flagNumber(args, "duration") ?? undefined,
      at: flagNumber(args, "at") ?? undefined,
    });
    return result.data;
  });
};

export const handleSlideDuplicate = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  await withSceneTransaction(args, output, (sceneJson) => {
    const result = applyOperation(sceneJson, {
      op: "slide.duplicate",
      slide: args.positionals[0],
      name: flagString(args, "name") ?? undefined,
      at: flagNumber(args, "at") ?? undefined,
    });
    return result.data;
  });
};

export const handleSlideMove = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  await withSceneTransaction(args, output, (sceneJson) => {
    const result = applyOperation(sceneJson, {
      op: "slide.move",
      slide: args.positionals[0],
      to: flagNumber(args, "to") ?? args.positionals[1],
    });
    return result.data;
  });
};

