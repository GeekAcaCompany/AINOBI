// SPDX-License-Identifier: AGPL-3.0-only
import {
  deserializeElementWithIssues,
  deserializeSceneWithIssues,
  type DeserializeOptions,
  type Element,
  type ParseIssue,
  type Scene,
} from "@ainobi/courseware-core";
import { AinobiCliError, issuesFromString, type CliIssue } from "./errors.ts";
import { enrichElementValidationHint } from "./validation-hints.ts";
import { normalizeLiteralEscapesInScene } from "./scene-text-escapes.ts";
import { normalizeTextElementRecord, normalizeTextElementsInScene } from "./text-element-normalize.ts";

const toCliIssues = (parseIssues: ParseIssue[]): CliIssue[] =>
  parseIssues.map((issue) => ({
    path: issue.path || "(root)",
    message: issue.message,
    value: issue.node,
  }));

const valueAtPath = (input: unknown, path: string): unknown => {
  const local = path
    .replace(/^root\.?/, "")
    .replace(/^element\.?/, "")
    .replace(/^slide\[\d+\]\.children_elements\[\]\.?/, "")
    .replace(/^slide\[\d+\]\.children_elements\[\d+\]\.?/, "");
  if (!local) return input;
  const tokens = local.match(/[^.[\]]+|\[\d+\]/g) ?? [];
  let cursor = input;
  for (const token of tokens) {
    if (cursor === null || cursor === undefined) return undefined;
    if (token.startsWith("[")) {
      const index = Number(token.slice(1, -1));
      cursor = Array.isArray(cursor) ? cursor[index] : undefined;
    } else {
      cursor = typeof cursor === "object" ? (cursor as Record<string, unknown>)[token] : undefined;
    }
  }
  return cursor;
};

const withIssueValues = (issues: CliIssue[], input: unknown): CliIssue[] =>
  issues.map((issue) => ({
    ...issue,
    value: issue.value === undefined ? valueAtPath(input, issue.path) : issue.value,
  }));

/**
 * Validate-and-normalize a scene from raw JSON. Returns a strictly typed
 * Scene plus any non-fatal issues. Throws AinobiCliError on hard failures.
 */
export const parseScene = (
  input: unknown,
  options: { allowSkip?: boolean } = {},
): { scene: Scene; warnings: CliIssue[] } => {
  const opts: DeserializeOptions = { skipInvalidNodes: !!options.allowSkip };
  try {
    const { value, issues } = deserializeSceneWithIssues(input, opts);
    const { scene: typographyScene, warnings: typographyWarnings } =
      normalizeTextElementsInScene(normalizeLiteralEscapesInScene(value));
    const scene = typographyScene;
    return { scene, warnings: [...toCliIssues(issues), ...typographyWarnings] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AinobiCliError("VALIDATION_ERROR", "Scene failed validation.", {
      issues: withIssueValues(issuesFromString(message), input),
      hint: "Use `ainobi help scene` for the expected shape.",
    });
  }
};

/**
 * Validate-and-normalize a single element from raw JSON.
 * Element ID is reassigned by the caller (state mutator) so callers can
 * pass `element_id` and we ignore it without an error.
 */
export const parseElement = (
  input: unknown,
  pathPrefix = "element",
): { element: Element; warnings: CliIssue[] } => {
  try {
    let payload = input;
    if (typeof input === "object" && input !== null && !Array.isArray(input)) {
      payload = normalizeTextElementRecord(input as Record<string, unknown>).record;
    }
    const { value, issues } = deserializeElementWithIssues(payload, { skipInvalidNodes: false });
    return { element: value, warnings: toCliIssues(issues) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const issues = withIssueValues(issuesFromString(message, pathPrefix), input);
    throw new AinobiCliError("VALIDATION_ERROR", `${pathPrefix} failed validation.`, {
      issues,
      hint:
        enrichElementValidationHint(issues) ??
        `Use \`ainobi help element <type>\` to see required fields and a working template.`,
    });
  }
};
