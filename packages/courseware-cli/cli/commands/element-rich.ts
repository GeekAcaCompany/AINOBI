// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { flagString, type ParsedArgs } from "../args.ts";
import { AinobiCliError, type CliIssue } from "../errors.ts";
import { requireScene, saveScene } from "../state.ts";
import { parseElement, parseScene } from "../validate.ts";
import { printSuccess, type OutputOptions } from "../output.ts";
import { buildPatchFromSetEntries, deepMerge } from "../patch.ts";
import { resolveElementPayloadInput } from "../input.ts";
import { getElementScaffold } from "../templates.ts";
import { newElementId } from "../ids.ts";
import { collectElementLayoutIssues } from "../element-layout-warnings.ts";
import { parseRichJsx, RichJsxParseError } from "../rich-jsx-parser.ts";
import {
  applyDefaultElementNameIfEmpty,
  serializeElement,
  serializeScene,
  validateRichAst,
  type RichAstNode,
} from "@ainobi/courseware-core";
import {
  applyCanvasCenterFlags,
  applyTimelineFlags,
  elementSummary,
  findChildIndex,
  findSlideIndex,
} from "./element.ts";

/** Fields agents must not set directly on a rich element via --set / --json. */
const REJECT_FROM_RICH_INPUT = new Set([
  "element_id",
  "element_type",
  "children_elements",
  "html",
  "react_layout",
]);

const readRichJsxSource = (args: ParsedArgs, prefix: string): string => {
  const inline = flagString(args, "jsx");
  const file = flagString(args, "jsx-file");
  if (inline !== undefined && file) {
    throw new AinobiCliError("USAGE", `${prefix}: pass only one of --jsx or --jsx-file.`);
  }
  if (file) {
    try {
      return readFileSync(file, "utf8");
    } catch (error) {
      throw new AinobiCliError(
        "INVALID_INPUT",
        `${prefix}: failed to read --jsx-file ${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (inline !== undefined) return inline;
  throw new AinobiCliError(
    "USAGE",
    `${prefix}: provide the component layout via --jsx-file <file.jsx> (or inline --jsx "<div …>…</div>").`,
  );
};

const parseRichLayoutOrThrow = (source: string, prefix: string): RichAstNode => {
  let ast: RichAstNode;
  try {
    ast = parseRichJsx(source);
  } catch (error) {
    if (error instanceof RichJsxParseError) {
      throw new AinobiCliError("INVALID_INPUT", `${prefix}: ${error.message}`);
    }
    throw error;
  }
  const issues = validateRichAst(ast);
  if (issues.length > 0) {
    throw new AinobiCliError("VALIDATION_ERROR", `${prefix}: rich layout has invalid nodes.`, {
      issues: issues.map((issue) => ({ path: issue.path, message: issue.message })),
    });
  }
  return ast;
};

const buildRichBoxPatch = (args: ParsedArgs, label: string): Record<string, unknown> => {
  const json = resolveElementPayloadInput(args);
  let patch: Record<string, unknown> = {};
  if (json !== null) {
    if (typeof json !== "object" || json === null || Array.isArray(json)) {
      throw new AinobiCliError("INVALID_INPUT", `--json for ${label} must be an object.`);
    }
    patch = { ...(json as Record<string, unknown>) };
  }
  const setEntries = args.multi.set ?? [];
  if (setEntries.length > 0) {
    patch = deepMerge(patch, buildPatchFromSetEntries(setEntries));
  }
  const nameFlag = flagString(args, "name");
  if (nameFlag !== undefined) patch.name = nameFlag;
  for (const key of REJECT_FROM_RICH_INPUT) {
    if (key in patch) {
      throw new AinobiCliError(
        "INVALID_INPUT",
        `${label} payload must not contain "${key}".`,
        {
          hint:
            key === "react_layout"
              ? "The component layout comes from --jsx / --jsx-file, not --set/--json."
              : `"${key}" is managed by the CLI.`,
        },
      );
    }
  }
  return patch;
};

export const handleElementRichInsert = async (
  args: ParsedArgs,
  output: OutputOptions,
): Promise<void> => {
  const { session, scene } = requireScene();
  const slideIdx = findSlideIndex(scene.slide_elements, args.positionals[0]);
  const slide = scene.slide_elements[slideIdx];

  const reactLayout = parseRichLayoutOrThrow(readRichJsxSource(args, "element rich insert"), "element rich insert");

  const scaffold = getElementScaffold("rich");
  let merged: Record<string, unknown> = deepMerge(
    scaffold,
    buildRichBoxPatch(args, "element rich insert"),
  );
  merged.react_layout = reactLayout;
  applyTimelineFlags(args, merged);
  merged.element_type = "rich";
  merged.element_id = newElementId("rich");
  delete (merged as Record<string, unknown>).children_elements;

  const compatWarnings: CliIssue[] = [];
  if (applyDefaultElementNameIfEmpty(merged, "rich", slide)) {
    compatWarnings.push({
      path: `slide[${slideIdx}].children_elements[].name`,
      message: `Assigned default name "${String(merged.name)}" (empty name omitted). Use --name to override.`,
      value: merged.name,
    });
  }

  applyCanvasCenterFlags(merged, slide, args);

  const { element: validated } = parseElement(merged, `slide[${slideIdx}].children_elements[]`);

  const layoutPath = `slide_elements[${slideIdx}].children_elements[] (${validated.element_id})`;
  const layoutWarnings = collectElementLayoutIssues(
    {
      element_id: validated.element_id,
      element_type: validated.element_type,
      name: validated.name,
      position: validated.position,
      size: validated.size,
    },
    { path: layoutPath, slideWidth: slide.size.width, slideHeight: slide.size.height },
  );

  const sceneJson = serializeScene(scene) as Record<string, unknown>;
  const slidesArr = [...(sceneJson.slide_elements as Record<string, unknown>[])];
  const childrenArr = [...((slidesArr[slideIdx].children_elements as unknown[]) ?? [])];
  childrenArr.push(serializeElement(validated));
  const insertAt = childrenArr.length - 1;
  slidesArr[slideIdx] = { ...slidesArr[slideIdx], children_elements: childrenArr };
  sceneJson.slide_elements = slidesArr;

  const { scene: validatedScene, warnings } = parseScene(sceneJson);
  await saveScene(session, validatedScene);

  const insertedSlide = validatedScene.slide_elements[slideIdx];
  const aggregated = [...compatWarnings, ...layoutWarnings, ...warnings];
  printSuccess(
    {
      slide_index: slideIdx,
      slide_id: insertedSlide.element_id,
      inserted_at: insertAt,
      element_id: validated.element_id,
      element: elementSummary(insertedSlide.children_elements[insertAt], insertAt),
    },
    output,
    aggregated.length > 0 ? aggregated : undefined,
  );
};

export const handleElementRichUpdate = async (
  args: ParsedArgs,
  output: OutputOptions,
): Promise<void> => {
  const { session, scene } = requireScene();
  const slideIdx = findSlideIndex(scene.slide_elements, args.positionals[0]);
  const slide = scene.slide_elements[slideIdx];
  const childIdx = findChildIndex(slide.children_elements, args.positionals[1]);
  const current = slide.children_elements[childIdx];
  if (current.element_type !== "rich") {
    throw new AinobiCliError(
      "INVALID_INPUT",
      `element ${current.element_id} is a "${current.element_type}", not a rich component.`,
      { hint: "Use `element update` for non-rich elements." },
    );
  }

  const hasJsx = flagString(args, "jsx") !== undefined || flagString(args, "jsx-file") !== undefined;
  const boxPatch = buildRichBoxPatch(args, "element rich update");
  if (!hasJsx && Object.keys(boxPatch).length === 0) {
    throw new AinobiCliError(
      "USAGE",
      "Usage: ainobi element rich update <slide> <element_ref> [--jsx-file f.jsx] [--set position.x=… size.width=… --start … --duration …]",
    );
  }

  let merged = deepMerge(serializeElement(current) as Record<string, unknown>, boxPatch) as Record<string, unknown>;
  merged.element_id = current.element_id;
  merged.element_type = "rich";
  delete (merged as Record<string, unknown>).children_elements;
  if (hasJsx) {
    merged.react_layout = parseRichLayoutOrThrow(
      readRichJsxSource(args, "element rich update"),
      "element rich update",
    );
  }
  applyTimelineFlags(args, merged);
  applyCanvasCenterFlags(merged, slide, args);

  const { element: validated } = parseElement(
    merged,
    `slide[${slideIdx}].children_elements[${childIdx}]`,
  );

  const layoutPath = `slide_elements[${slideIdx}].children_elements[${childIdx}] (${validated.element_id})`;
  const layoutWarnings = collectElementLayoutIssues(
    {
      element_id: validated.element_id,
      element_type: validated.element_type,
      name: validated.name,
      position: validated.position,
      size: validated.size,
    },
    { path: layoutPath, slideWidth: slide.size.width, slideHeight: slide.size.height },
  );

  const sceneJson = serializeScene(scene) as Record<string, unknown>;
  const slidesArr = [...(sceneJson.slide_elements as Record<string, unknown>[])];
  const childrenArr = [...((slidesArr[slideIdx].children_elements as unknown[]) ?? [])];
  childrenArr[childIdx] = serializeElement(validated);
  slidesArr[slideIdx] = { ...slidesArr[slideIdx], children_elements: childrenArr };
  sceneJson.slide_elements = slidesArr;

  const { scene: validatedScene, warnings } = parseScene(sceneJson);
  await saveScene(session, validatedScene);

  const updatedSlide = validatedScene.slide_elements[slideIdx];
  const aggregated = [...layoutWarnings, ...warnings];
  printSuccess(
    {
      slide_index: slideIdx,
      slide_id: updatedSlide.element_id,
      element_index: childIdx,
      updated_fields: hasJsx ? ["react_layout", ...Object.keys(boxPatch)] : Object.keys(boxPatch),
      element: elementSummary(updatedSlide.children_elements[childIdx], childIdx),
    },
    output,
    aggregated.length > 0 ? aggregated : undefined,
  );
};
