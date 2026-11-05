// SPDX-License-Identifier: AGPL-3.0-only
import { flagBool, flagNumber, flagString, type ParsedArgs } from "../args.ts";
import { AinobiCliError } from "../errors.ts";
import { resolveJsonInput } from "../input.ts";
import { applyOperation } from "../operations.ts";
import { buildPatchFromSetEntries, deepMerge } from "../patch.ts";
import { newElementId } from "../ids.ts";
import { requireScene, saveScene } from "../state.ts";
import { parseScene } from "../validate.ts";
import { compactLargeStrings } from "../compact-json-output.ts";
import { printSuccess, type OutputOptions } from "../output.ts";
import { getElementScaffold } from "../templates.ts";
import { serializeElement, serializeScene, type Element, type SlideElement } from "@ainobi/courseware-core";
import { remapSlideFlowPausePointsOnDurationChange } from "@ainobi/courseware-core/slide-flow-pause.ts";
import { withSceneTransaction } from "../transaction.ts";

/**
 * Slide-level fields the AI agent is allowed to set.
 * Anything outside this list is rejected up front so the agent never has to
 * deal with hidden side effects on children/auto-managed metadata.
 */
const ALLOWED_SLIDE_FIELDS = new Set([
  "element_type",
  "name",
  "fps",
  "position",
  "size",
  "timeline",
  "style",
  "enter_effect",
  "exit_effect",
  "animations",
  "keyframes",
  "event_bindings",
  "action_mappings",
  "event_scripts",
  "preset_script",
  "metadata",
  "background_color",
  "background_image_url",
  "background_image_fit",
  "background_html_src",
  "background_html_content_zoom",
]);

const REJECT_FROM_SLIDE_INPUT = new Set([
  "children_elements",
  "element_id",
]);

const slideSummary = (slide: SlideElement, index: number) => ({
  index,
  element_id: slide.element_id,
  name: slide.name,
  background_color: slide.background_color,
  size: slide.size,
  timeline: slide.timeline,
  z_index: slide.style.z_index,
  children_count: slide.children_elements.length,
});

const findSlideIndex = (
  slides: SlideElement[],
  ref: string | undefined,
  errorContext = "slide",
): number => {
  if (ref === undefined || ref === "") {
    throw new AinobiCliError("USAGE", `Missing ${errorContext} reference (id or index).`);
  }
  if (/^-?\d+$/.test(ref)) {
    const idx = Number(ref);
    if (idx < 0 || idx >= slides.length) {
      throw new AinobiCliError(
        "NOT_FOUND",
        `${errorContext} index ${idx} is out of range (0..${slides.length - 1}).`,
      );
    }
    return idx;
  }
  const idx = slides.findIndex((slide) => slide.element_id === ref);
  if (idx < 0) {
    throw new AinobiCliError("NOT_FOUND", `${errorContext} not found: "${ref}".`);
  }
  return idx;
};

export const handleSlideList = (args: ParsedArgs, output: OutputOptions): void => {
  const { scene } = requireScene();
  const verbose = flagBool(args, "verbose", false);
  printSuccess(
    {
      slide_count: scene.slide_elements.length,
      slides: scene.slide_elements.map((slide, index) =>
        verbose
          ? {
              ...slideSummary(slide, index),
              children: slide.children_elements.map((child, ci) => ({
                index: ci,
                element_id: child.element_id,
                element_type: child.element_type,
                name: child.name,
              })),
            }
          : slideSummary(slide, index),
      ),
    },
    output,
  );
};

export const handleSlideGet = (args: ParsedArgs, output: OutputOptions): void => {
  const { scene } = requireScene();
  const ref = args.positionals[0];
  const idx = findSlideIndex(scene.slide_elements, ref);
  const slide = scene.slide_elements[idx];
  const includeChildren = flagBool(args, "with-children", false);
  const fullChildren = flagBool(args, "full-children", false);
  const serialized = serializeElement(slide) as Record<string, unknown>;
  let slidePayload: Record<string, unknown> = { ...serialized };
  if (!includeChildren) {
    delete slidePayload.children_elements;
    printSuccess(
      {
        index: idx,
        slide: slidePayload,
        children_count: slide.children_elements.length,
      },
      output,
    );
    return;
  }
  if (!fullChildren) {
    slidePayload = compactLargeStrings(slidePayload, {}) as Record<string, unknown>;
  }
  printSuccess({ index: idx, slide: slidePayload }, output);
};

const stripInternalFields = (input: Record<string, unknown>, label: string): Record<string, unknown> => {
  const out = { ...input };
  for (const key of REJECT_FROM_SLIDE_INPUT) {
    if (key in out) {
      throw new AinobiCliError(
        "INVALID_INPUT",
        `${label} payload must not contain "${key}".`,
        {
          hint:
            key === "children_elements"
              ? "Slides cannot accept children at insert/update time. Use `ainobi element insert` afterwards."
              : "element_id is generated automatically; never specify it externally.",
        },
      );
    }
  }
  for (const key of Object.keys(out)) {
    if (!ALLOWED_SLIDE_FIELDS.has(key)) {
      throw new AinobiCliError(
        "INVALID_INPUT",
        `${label} payload field "${key}" is not allowed for slides.`,
        { hint: `Allowed fields: ${[...ALLOWED_SLIDE_FIELDS].join(", ")}.` },
      );
    }
  }
  return out;
};

const buildSlidePayload = (
  args: ParsedArgs,
  defaults: Record<string, unknown>,
  label: string,
): Record<string, unknown> => {
  const json = resolveJsonInput(args);
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
  const bgFlag = flagString(args, "background");
  if (bgFlag !== undefined) patch.background_color = bgFlag;
  const durationFlag = flagNumber(args, "duration");
  if (durationFlag !== undefined) {
    const t = (patch.timeline as Record<string, unknown> | undefined) ?? {};
    const defaultTimeline =
      typeof defaults.timeline === "object" && defaults.timeline !== null
        ? (defaults.timeline as Record<string, unknown>)
        : {};
    patch.timeline = { ...defaultTimeline, ...t, end_at: durationFlag };
  }
  return stripInternalFields(patch, label);
};

export const handleSlideInsert = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  const { session, scene } = requireScene();
  const scaffold = getElementScaffold("slide");
  const payload = buildSlidePayload(args, scaffold, "slide insert");

  const merged = deepMerge(scaffold, payload) as Record<string, unknown>;
  merged.element_id = newElementId("slide");
  merged.children_elements = [];

  const at = flagNumber(args, "at");
  const insertIndex = at === undefined
    ? scene.slide_elements.length
    : Math.max(0, Math.min(Math.floor(at), scene.slide_elements.length));

  const sceneJson = serializeScene(scene) as Record<string, unknown>;
  const slidesArr = [...(sceneJson.slide_elements as unknown[])];
  slidesArr.splice(insertIndex, 0, merged);
  sceneJson.slide_elements = slidesArr;

  const transitions = [...((sceneJson.transitions as string[] | undefined) ?? [])];
  while (transitions.length < Math.max(0, slidesArr.length - 1)) {
    transitions.push("none");
  }
  sceneJson.transitions = transitions.slice(0, Math.max(0, slidesArr.length - 1));

  const { scene: validated, warnings } = parseScene(sceneJson);
  await saveScene(session, validated);

  const inserted = validated.slide_elements[insertIndex];
  printSuccess(
    {
      inserted_at: insertIndex,
      slide: slideSummary(inserted, insertIndex),
      element_id: inserted.element_id,
      slide_count: validated.slide_elements.length,
    },
    output,
    warnings.length > 0 ? warnings : undefined,
  );
};

export const handleSlideUpdate = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  const { session, scene } = requireScene();
  const ref = args.positionals[0];
  const idx = findSlideIndex(scene.slide_elements, ref);

  const sceneJson = serializeScene(scene) as Record<string, unknown>;
  const slidesArr = [...(sceneJson.slide_elements as Record<string, unknown>[])];
  const current = slidesArr[idx];

  const payload = buildSlidePayload(args, current, "slide update");
  if (Object.keys(payload).length === 0) {
    throw new AinobiCliError(
      "USAGE",
      "Provide at least one change via --json, --set, --name, --background, or --duration.",
    );
  }
  const previousTimeline = { ...(current.timeline as Record<string, unknown> | undefined) };
  const next = deepMerge(current, payload) as Record<string, unknown>;
  next.element_id = current.element_id;
  next.children_elements = (current.children_elements as Element[]) ?? [];
  remapSlideFlowPausePointsOnDurationChange(next, previousTimeline);
  slidesArr[idx] = next;
  sceneJson.slide_elements = slidesArr;

  const { scene: validated, warnings } = parseScene(sceneJson);
  await saveScene(session, validated);

  printSuccess(
    {
      updated_index: idx,
      updated_fields: Object.keys(payload),
      slide: slideSummary(validated.slide_elements[idx], idx),
    },
    output,
    warnings.length > 0 ? warnings : undefined,
  );
};

export const handleSlideDelete = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  const { scene } = requireScene();
  const ref = args.positionals[0];
  const idx = findSlideIndex(scene.slide_elements, ref);
  const removed = scene.slide_elements[idx];

  await withSceneTransaction(args, output, (sceneJson) => {
    const result = applyOperation(sceneJson, {
      op: "slide.delete",
      slide: ref,
    });
    return {
      removed_index: idx,
      removed_element_id: removed.element_id,
      removed_name: removed.name,
      removed_question_ids: result.data.removed_question_ids ?? [],
      slide_count: ((sceneJson.slide_elements as unknown[]) ?? []).length,
    };
  });
};
