// SPDX-License-Identifier: AGPL-3.0-only
import type { ParsedArgs } from "./args.ts";
import { AinobiCliError, type CliIssue } from "./errors.ts";
import { printSuccess, type OutputOptions } from "./output.ts";
import { maybeQuietMutationData } from "./quiet-output.ts";
import { assertNoNewReplacementChars } from "./replacement-char-guard.ts";
import { assertNoNewRichScaffoldText } from "./rich-layout-guards.ts";
import { requireScene, saveScene } from "./state.ts";
import { parseScene } from "./validate.ts";
import { serializeScene, type Scene } from "@ainobi/courseware-core";

export interface TransactionResult<T = Record<string, unknown>> {
  data: T;
  scene?: Scene;
  warnings?: CliIssue[];
}

export type SceneMutator<T = Record<string, unknown>> = (
  sceneJson: Record<string, unknown>,
  args: ParsedArgs,
) => TransactionResult<T> | T;

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const isTransactionResult = <T>(value: unknown): value is TransactionResult<T> =>
  typeof value === "object" && value !== null && "data" in value;

export const runSceneTransaction = async <T = Record<string, unknown>>(
  args: ParsedArgs,
  mutator: SceneMutator<T>,
  options: { dryRun?: boolean } = {},
): Promise<TransactionResult<T> & { dirty: boolean }> => {
  const { session, scene } = requireScene();
  const sceneJson = cloneJson(serializeScene(scene)) as Record<string, unknown>;
  const result = mutator(sceneJson, args);
  const normalized: TransactionResult<T> = isTransactionResult<T>(result)
    ? result
    : { data: result as T };
  const nextSceneJson = normalized.scene ? serializeScene(normalized.scene) : sceneJson;
  const { scene: validated, warnings } = parseScene(nextSceneJson);
  if (!options.dryRun) {
    await saveScene(session, validated);
  } else {
    // dry-run writes nothing, but must refuse garbled text / rich scaffold placeholder text exactly like apply (the same guard as in saveScene).
    const nextSerialized = serializeScene(validated);
    assertNoNewReplacementChars(session.scene, nextSerialized);
    assertNoNewRichScaffoldText(session.scene, nextSerialized);
  }
  return {
    ...normalized,
    scene: validated,
    warnings: [...(normalized.warnings ?? []), ...warnings],
    dirty: !options.dryRun,
  };
};

export const withSceneTransaction = async <T = Record<string, unknown>>(
  args: ParsedArgs,
  output: OutputOptions,
  mutator: SceneMutator<T>,
  options: { dryRun?: boolean } = {},
): Promise<void> => {
  const result = await runSceneTransaction(args, mutator, options);
  const payload = {
    ...((typeof result.data === "object" && result.data !== null)
      ? (result.data as Record<string, unknown>)
      : { result: result.data }),
    dry_run: !!options.dryRun,
    dirty: result.dirty,
  };
  printSuccess(maybeQuietMutationData(payload, output.quiet), output, result.warnings);
};

export const assertObjectPayload = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AinobiCliError("INVALID_INPUT", `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
};

