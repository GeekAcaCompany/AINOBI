// SPDX-License-Identifier: AGPL-3.0-only
import type { ParsedArgs } from "../args.ts";
import { AinobiCliError } from "../errors.ts";
import { readJsonFile, resolveJsonInput } from "../input.ts";
import { applyOperations, type Operation } from "../operations.ts";
import type { OutputOptions } from "../output.ts";
import { withSceneTransaction } from "../transaction.ts";

const readOperations = (args: ParsedArgs): Operation[] => {
  const positional = args.positionals[0];
  const raw = positional && positional !== "-"
    ? readJsonFile(positional)
    : resolveJsonInput(args, { allowPositional: positional });
  if (raw === null) {
    throw new AinobiCliError("USAGE", "Provide batch JSON via --file, --json, --stdin, or `-`.");
  }
  const operations = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw !== null && Array.isArray((raw as { operations?: unknown }).operations)
      ? (raw as { operations: unknown[] }).operations
      : null;
  if (!operations) {
    throw new AinobiCliError("INVALID_INPUT", "Batch payload must be an array or { operations: [...] }.");
  }
  return operations.map((op, index) => {
    if (typeof op !== "object" || op === null || Array.isArray(op)) {
      throw new AinobiCliError("INVALID_INPUT", `operations[${index}] must be an object.`);
    }
    return op as Operation;
  });
};

const runBatch = async (args: ParsedArgs, output: OutputOptions, dryRun: boolean): Promise<void> => {
  const operations = readOperations(args);
  await withSceneTransaction(
    args,
    output,
    (sceneJson) => {
      const results = applyOperations(sceneJson, operations);
      // Quiet output drops per-op bodies, so surface input auto-fixes as warnings.
      const warnings = results.flatMap((result, index) => {
        const fixes = (result.data as { auto_fixed?: unknown } | undefined)?.auto_fixed;
        return Array.isArray(fixes) && fixes.length > 0
          ? [{ path: `operations[${index}]`, message: `Auto-fixed input: ${fixes.join("; ")}.` }]
          : [];
      });
      return {
        data: {
          operations_applied: results.length,
          results,
        },
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    },
    { dryRun },
  );
};

export const handleBatchApply = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  await runBatch(args, output, false);
};

export const handleBatchDryRun = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  await runBatch(args, output, true);
};

