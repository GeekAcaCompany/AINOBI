// SPDX-License-Identifier: AGPL-3.0-only
import { jsonrepair } from "jsonrepair";

/**
 * Strip prose/markdown wrappers and keep the outermost JSON object or array span.
 */
export function removeNonJSONText(input: string): string {
  const beginningBrace = input.indexOf("{");
  const endingBrace = input.lastIndexOf("}");
  const beginningBracket = input.indexOf("[");
  const endingBracket = input.lastIndexOf("]");

  const beginningIndex = Math.min(
    beginningBrace !== -1 ? beginningBrace : Number.POSITIVE_INFINITY,
    beginningBracket !== -1 ? beginningBracket : Number.POSITIVE_INFINITY,
  );

  const endingIndex = Math.max(
    endingBrace !== -1 ? endingBrace : Number.NEGATIVE_INFINITY,
    endingBracket !== -1 ? endingBracket : Number.NEGATIVE_INFINITY,
  );

  if (!Number.isFinite(beginningIndex) || endingIndex === Number.NEGATIVE_INFINITY) {
    throw new Error("No JSON object or array found.");
  }

  return input.substring(beginningIndex, endingIndex + 1);
}

/**
 * Parse LLM JSON output with jsonrepair fallback (aligned with backend json-repair usage).
 */
export function repairJSON(input: string): unknown {
  try {
    return JSON.parse(jsonrepair(removeNonJSONText(input)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`JSON repair Error: ${message}`);
  }
}
