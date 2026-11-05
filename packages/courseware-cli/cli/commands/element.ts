// SPDX-License-Identifier: AGPL-3.0-only
import { flagBool, flagNumber, flagString, type ParsedArgs } from "../args.ts";
import { collectElementLayoutIssues } from "../element-layout-warnings.ts";
import { collectTextElementQualityIssues } from "../text-quality-warnings.ts";
import { collectQuizSlideMediaWarnings } from "../element-quiz-media-warnings.ts";
import { assertNoNewReplacementChars } from "../replacement-char-guard.ts";
import { AinobiCliError } from "../errors.ts";
import { resolveElementPayloadInput } from "../input.ts";
import { applyOperation } from "../operations.ts";
import { buildPatchFromSetEntries, deepMerge } from "../patch.ts";
import { newElementId } from "../ids.ts";
import { requireScene, saveScene } from "../state.ts";
import { parseElement, parseScene } from "../validate.ts";
import { compactLargeStrings } from "../compact-json-output.ts";
import { printSuccess, type OutputOptions } from "../output.ts";
import { maybeQuietMutationData } from "../quiet-output.ts";
import {
  convertDocumentAsset,
  normalizeAssetExtension,
  uploadFileAsset,
  type ConvertedDocumentAsset,
  type UploadedAsset,
} from "../assets.ts";
import { ELEMENT_TYPES_VALID_AS_SLIDE_CHILD, getElementScaffold } from "../templates.ts";
import {
  applyDefaultElementNameIfEmpty,
  serializeElement,
  serializeScene,
  type Element,
  type ElementType,
  type SlideElement,
} from "@ainobi/courseware-core";
import { collectSvgElementIssues } from "../svg-bounds.ts";
import type { CliIssue } from "../errors.ts";
import {
  expandTextTypographySetEntries,
  normalizeTextElementRecord,
} from "../text-element-normalize.ts";
import {
  fillElementTimingGaps,
  normalizeElementInputRecord,
  normalizeElementShapeInput,
  resolveChildRefByIdOrName,
  resolveElementTypeAlias,
} from "../element-input-compat.ts";
import { withSceneTransaction } from "../transaction.ts";
import { assertRichInsertHasLayout, rejectPartialReactLayoutSetEntries } from "../rich-layout-guards.ts";

export const findSlideIndex = (slides: SlideElement[], ref: string | undefined): number => {
  if (ref === undefined || ref === "") {
    throw new AinobiCliError("USAGE", "Missing slide reference (id or index).");
  }
  if (/^-?\d+$/.test(ref)) {
    const idx = Number(ref);
    if (idx < 0 || idx >= slides.length) {
      throw new AinobiCliError(
        "NOT_FOUND",
        `slide index ${idx} is out of range (0..${slides.length - 1}).`,
      );
    }
    return idx;
  }
  const idx = slides.findIndex((slide) => slide.element_id === ref);
  if (idx < 0) {
    throw new AinobiCliError("NOT_FOUND", `slide not found: "${ref}".`);
  }
  return idx;
};

export const findChildIndex = (children: Element[], ref: string | undefined): number => {
  if (ref === undefined || ref === "") {
    throw new AinobiCliError("USAGE", "Missing element reference (id or index).");
  }
  if (/^-?\d+$/.test(ref)) {
    const idx = Number(ref);
    if (idx < 0 || idx >= children.length) {
      throw new AinobiCliError(
        "NOT_FOUND",
        `element index ${idx} is out of range (0..${children.length - 1}).`,
      );
    }
    return idx;
  }
  return resolveChildRefByIdOrName(children, ref);
};

export const elementSummary = (el: Element, index: number) => ({
  index,
  element_id: el.element_id,
  element_type: el.element_type,
  name: el.name,
  position: el.position,
  size: el.size,
  timeline: el.timeline,
  z_index: el.style.z_index,
});

const REJECT_FROM_ELEMENT_INPUT = new Set([
  "element_id",
  "children_elements",
  "html",
]);

const stripInternalElementFields = (
  payload: Record<string, unknown>,
  label: string,
): Record<string, unknown> => {
  for (const key of REJECT_FROM_ELEMENT_INPUT) {
    if (key in payload) {
      throw new AinobiCliError(
        "INVALID_INPUT",
        `${label} payload must not contain "${key}".`,
        {
          hint:
            key === "children_elements"
              ? "Nested children of group/html/slide are not editable through the element CLI."
              : key === "html"
                ? "Do not put page/widget HTML in element.html. Use `element insert <slide> --type html --asset page.html` or --json with element_type html and src (http(s) URL or data:text/html;…)."
                : "element_id is generated automatically; never specify it externally.",
        },
      );
    }
  }
  return payload;
};

const buildElementPayload = (
  args: ParsedArgs,
  label: string,
): Record<string, unknown> => {
  const json = resolveElementPayloadInput(args);
  let patch: Record<string, unknown> = {};
  if (json !== null) {
    if (typeof json !== "object" || json === null || Array.isArray(json)) {
      throw new AinobiCliError("INVALID_INPUT", `--json for ${label} must be an object.`);
    }
    patch = { ...(json as Record<string, unknown>) };
  }
  const setEntries = args.multi.set ?? [];
  rejectPartialReactLayoutSetEntries(setEntries, label);
  if (setEntries.length > 0) {
    patch = deepMerge(patch, buildPatchFromSetEntries(expandTextTypographySetEntries(setEntries)));
  }
  const nameFlag = flagString(args, "name");
  if (nameFlag !== undefined) patch.name = nameFlag;
  return normalizeElementInputRecord(stripInternalElementFields(patch, label));
};

const boxAxisSize = (record: Record<string, unknown>, axis: "x" | "y"): number => {
  const size = record.size as { width?: number; height?: number } | undefined;
  return axis === "x" ? Number(size?.width ?? 0) : Number(size?.height ?? 0);
};

/** Pin element box to slide canvas center using final merged size (position stays top-left). */
export const applyCanvasCenterFlags = (
  record: Record<string, unknown>,
  slide: SlideElement,
  args: ParsedArgs,
): void => {
  const centerX = flagBool(args, "center-x", false);
  const centerY = flagBool(args, "center-y", false);
  if (!centerX && !centerY) return;

  const position = { ...(record.position as { x?: number; y?: number } | undefined) };
  if (centerX) {
    const width = boxAxisSize(record, "x");
    if (width <= 0) {
      throw new AinobiCliError(
        "USAGE",
        "--center-x requires a positive size.width (set via --set or scaffold defaults).",
      );
    }
    position.x = Math.round((slide.size.width - width) / 2);
  }
  if (centerY) {
    const height = boxAxisSize(record, "y");
    if (height <= 0) {
      throw new AinobiCliError(
        "USAGE",
        "--center-y requires a positive size.height (set via --set or scaffold defaults).",
      );
    }
    position.y = Math.round((slide.size.height - height) / 2);
  }
  record.position = position;
};

export const applyTimelineFlags = (args: ParsedArgs, payload: Record<string, unknown>): void => {
  const start = flagNumber(args, "start");
  const end = flagNumber(args, "end");
  const duration = flagNumber(args, "duration");
  if (end !== undefined && duration !== undefined) {
    throw new AinobiCliError("USAGE", "Use either --end or --duration for element timing, not both.");
  }
  if (start === undefined && end === undefined && duration === undefined) return;
  const timeline = (payload.timeline as Record<string, unknown> | undefined) ?? {};
  const nextStart = start ?? Number(timeline.start_at ?? 0);
  const nextEnd = duration !== undefined
    ? nextStart + duration
    : end ?? Number(timeline.end_at ?? nextStart);
  payload.timeline = {
    ...timeline,
    start_at: nextStart,
    end_at: nextEnd,
  };
};

export const handleElementList = (args: ParsedArgs, output: OutputOptions): void => {
  const { scene } = requireScene();
  const slideRef = args.positionals[0];
  const idx = findSlideIndex(scene.slide_elements, slideRef);
  const slide = scene.slide_elements[idx];
  const verbose = flagBool(args, "verbose", false);
  const fullElements = flagBool(args, "full-elements", false);
  printSuccess(
    {
      slide_index: idx,
      slide_id: slide.element_id,
      element_count: slide.children_elements.length,
      elements: slide.children_elements.map((child: Element, ci: number) => {
        if (!verbose) return elementSummary(child, ci);
        const ser = serializeElement(child) as Record<string, unknown>;
        return fullElements ? ser : (compactLargeStrings(ser, {}) as Record<string, unknown>);
      }),
    },
    output,
  );
};

export const handleElementGet = (args: ParsedArgs, output: OutputOptions): void => {
  const { scene } = requireScene();
  const slideRef = args.positionals[0];
  const elementRef = args.positionals[1];
  if (elementRef === undefined && slideRef !== undefined) {
    const looksLikeChildElementId =
      /^el_[a-z0-9_]+$/i.test(slideRef) && !/^el_slide_/i.test(slideRef);
    if (looksLikeChildElementId) {
      throw new AinobiCliError(
        "USAGE",
        "`element get` requires two arguments: <slide> (index or slide element_id) and <ref> (child element_id or index).",
        {
          hint: `Example: ainobi element get 0 ${slideRef}`,
        },
      );
    }
  }
  const slideIdx = findSlideIndex(scene.slide_elements, slideRef);
  const slide = scene.slide_elements[slideIdx];
  const childIdx = findChildIndex(slide.children_elements, elementRef);
  printSuccess(
    {
      slide_index: slideIdx,
      slide_id: slide.element_id,
      element_index: childIdx,
      element: serializeElement(slide.children_elements[childIdx]),
    },
    output,
  );
};

const ensureValidChildType = (type: string): ElementType => {
  if (!ELEMENT_TYPES_VALID_AS_SLIDE_CHILD.includes(type as ElementType)) {
    throw new AinobiCliError(
      "INVALID_INPUT",
      `element_type "${type}" is not allowed inside a slide.`,
      {
        hint: `Allowed types: ${ELEMENT_TYPES_VALID_AS_SLIDE_CHILD.join(", ")}.`,
      },
    );
  }
  return type as ElementType;
};

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg", ".tiff"]);
const audioExtensions = new Set([".mp3", ".aac", ".wav", ".ogg"]);
const videoExtensions = new Set([".mp4", ".webm"]);

const inferElementTypeFromAsset = (filePath: string): ElementType => {
  const extension = normalizeAssetExtension(filePath);
  if (extension === ".pdf" || extension === ".pptx") return "ppt";
  if (extension === ".html") return "html";
  if (extension === ".svg") return "svg";
  if (imageExtensions.has(extension)) return "image";
  if (audioExtensions.has(extension)) return "audio";
  if (videoExtensions.has(extension)) return "video";
  throw new AinobiCliError("UNSUPPORTED", `Cannot infer an element type for asset extension "${extension}".`);
};

const assetMetadata = (asset: UploadedAsset | ConvertedDocumentAsset): Record<string, unknown> => ({
  courseware_asset: {
    file_id: asset.file_id,
    file_name: asset.file_name,
    extension: asset.extension,
    bytes: asset.bytes,
    object_key: asset.object_key,
    url: asset.url,
    existed: asset.existed,
  },
});

const attachAssetToElementPayload = async (
  elementType: ElementType,
  filePath: string,
  payload: Record<string, unknown>,
): Promise<UploadedAsset | ConvertedDocumentAsset> => {
  const extension = normalizeAssetExtension(filePath);

  if (elementType === "ppt") {
    if (extension !== ".pdf" && extension !== ".pptx") {
      throw new AinobiCliError("UNSUPPORTED", "PPT elements can only use --asset with .pdf or .pptx files.");
    }
    const converted = await convertDocumentAsset(filePath);
    payload.src = converted.artifact_src;
    payload.slide_count = converted.slide_count;
    payload.slide_ranges = payload.slide_ranges ?? [];
    payload.metadata = deepMerge((payload.metadata as Record<string, unknown> | undefined) ?? {}, {
      ...assetMetadata(converted),
      conversion: {
        artifact_src: converted.artifact_src,
        slide_count: converted.slide_count,
      },
    });
    return converted;
  }

  const assertMatches = (allowed: Set<string>, label: string) => {
    if (!allowed.has(extension)) {
      throw new AinobiCliError("UNSUPPORTED", `${label} elements cannot use assets with extension "${extension}".`);
    }
  };

  if (elementType === "image") assertMatches(imageExtensions, "Image");
  else if (elementType === "svg") assertMatches(new Set([".svg"]), "SVG");
  else if (elementType === "audio") assertMatches(audioExtensions, "Audio");
  else if (elementType === "video") assertMatches(videoExtensions, "Video");
  else if (elementType === "html") assertMatches(new Set([".html"]), "HTML");
  else {
    throw new AinobiCliError("UNSUPPORTED", `--asset is not supported for element type "${elementType}".`);
  }

  const uploaded = await uploadFileAsset(filePath);
  if (elementType === "html") {
    payload.src = uploaded.url;
  } else {
    payload.source = uploaded.url;
  }
  payload.metadata = deepMerge((payload.metadata as Record<string, unknown> | undefined) ?? {}, assetMetadata(uploaded));
  return uploaded;
};

export const handleElementInsert = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  const { session, scene } = requireScene();
  const slideIdx = findSlideIndex(scene.slide_elements, args.positionals[0]);
  const slide = scene.slide_elements[slideIdx];

  const typeFlag = flagString(args, "type");
  const assetPath = flagString(args, "asset");
  const json = resolveElementPayloadInput(args);
  const jsonObj = (json && typeof json === "object" && !Array.isArray(json))
    ? (json as Record<string, unknown>)
    : null;

  const inferredType = typeFlag ?? (jsonObj?.element_type as string | undefined) ?? (assetPath ? inferElementTypeFromAsset(assetPath) : undefined);
  if (!inferredType) {
    throw new AinobiCliError(
      "USAGE",
      "Specify element type via --type <type> (or include element_type in --json).",
      { hint: `Use \`ainobi help types\` to list element types.` },
    );
  }
  const typeAlias = resolveElementTypeAlias(inferredType);
  const elementType = ensureValidChildType(typeAlias.elementType);
  const compatWarnings: CliIssue[] = [...typeAlias.warnings];

  const setEntries = args.multi.set ?? [];
  rejectPartialReactLayoutSetEntries(setEntries, "element insert");
  const setPatch =
    setEntries.length > 0 ? buildPatchFromSetEntries(expandTextTypographySetEntries(setEntries)) : null;
  assertRichInsertHasLayout(
    elementType,
    { react_layout: setPatch?.react_layout ?? jsonObj?.react_layout },
    "element insert",
  );

  const scaffold = getElementScaffold(elementType);
  let merged: Record<string, unknown> = scaffold;
  if (jsonObj) {
    merged = deepMerge(
      merged,
      normalizeElementInputRecord(stripInternalElementFields({ ...jsonObj }, "element insert")),
    );
  }
  const hasExplicitTimelineFlags =
    flagNumber(args, "start") !== undefined ||
    flagNumber(args, "end") !== undefined ||
    flagNumber(args, "duration") !== undefined;
  const timelineInPatch =
    (jsonObj?.timeline !== undefined) ||
    setEntries.some((entry) => {
      const path = entry.split("=")[0]?.trim() ?? "";
      return path === "timeline" || path.startsWith("timeline.");
    });
  if (setPatch) {
    merged = deepMerge(merged, setPatch);
  }
  const nameFlag = flagString(args, "name");
  if (nameFlag !== undefined) merged.name = nameFlag;
  merged = normalizeElementInputRecord(merged);
  if (
    elementType === "html" &&
    !hasExplicitTimelineFlags &&
    !timelineInPatch
  ) {
    merged.timeline = {
      start_at: slide.timeline.start_at,
      end_at: slide.timeline.end_at,
    };
  }
  // Reject corrupt text before the asset upload so a failed write never leaves an
  // orphan upload behind (saveScene runs the same guard later; Codex review #143).
  assertNoNewReplacementChars(null, merged, `slide[${slideIdx}].children_elements[]`);
  const asset = assetPath ? await attachAssetToElementPayload(elementType, assetPath, merged) : null;
  applyTimelineFlags(args, merged);

  merged.element_type = elementType;
  merged.element_id = newElementId(elementType);

  if (elementType === "group" || elementType === "html") {
    merged.children_elements = (merged.children_elements as unknown[] | undefined) ?? [];
  } else {
    delete (merged as Record<string, unknown>).children_elements;
  }

  const typographyNotes: CliIssue[] = [];
  if (applyDefaultElementNameIfEmpty(merged, elementType, slide)) {
    compatWarnings.push({
      path: `slide[${slideIdx}].children_elements[].name`,
      message: `Assigned default name "${String(merged.name)}" (empty name omitted). Use --name to override.`,
      value: merged.name,
    });
  }

  if (elementType === "text") {
    const normalized = normalizeTextElementRecord(merged);
    merged = normalized.record;
    if (normalized.promotions.length > 0) {
      typographyNotes.push({
        path: `slide[${slideIdx}].children_elements[]`,
        message:
          `Promoted ${normalized.promotions.join(", ")} from style to root text fields. ` +
          "Prefer --set color / font_size / line_height / bold / align; style.* aliases are copied to root on write.",
        value: { promotions: normalized.promotions },
      });
    }
  }

  const insertShape = normalizeElementShapeInput(merged);
  merged = insertShape.record;
  applyCanvasCenterFlags(merged, slide, args);
  const insertTiming = fillElementTimingGaps(merged);
  merged = insertTiming.record;
  const insertGaps = { fixes: [...insertShape.fixes, ...insertTiming.fixes] };
  if (insertGaps.fixes.length > 0) {
    typographyNotes.push({
      path: `slide[${slideIdx}].children_elements[]`,
      message: `Auto-fixed input: ${insertGaps.fixes.join("; ")}.`,
    });
  }

  const { element: validated } = parseElement(merged, `slide[${slideIdx}].children_elements[]`);

  const layoutPath = `slide_elements[${slideIdx}].children_elements[] (${validated.element_id})`;
  const layoutWarnings = collectElementLayoutIssues(
    {
      element_id: validated.element_id,
      element_type: validated.element_type,
      name: validated.name,
      position: validated.position,
      size: validated.size,
      align: validated.element_type === "text" ? validated.align : undefined,
    },
    { path: layoutPath, slideWidth: slide.size.width, slideHeight: slide.size.height },
  );

  const textQualityWarnings =
    validated.element_type === "text"
      ? collectTextElementQualityIssues(
          {
            element_id: validated.element_id,
            element_type: validated.element_type,
            name: validated.name,
            text: validated.text,
            font_size: validated.font_size,
            line_height: validated.line_height,
            size: validated.size,
          },
          { path: layoutPath },
        )
      : [];

  const svgWarnings: CliIssue[] =
    validated.element_type === "svg"
      ? collectSvgElementIssues(validated, {
          path: layoutPath,
          slideWidth: slide.size.width,
          slideHeight: slide.size.height,
        })
      : [];

  const quizMediaWarnings = collectQuizSlideMediaWarnings({
    slideIndex: slideIdx,
    elementType: validated.element_type,
    position: validated.position,
    size: validated.size,
    slideChildren: slide.children_elements.map((child) => ({
      element_id: child.element_id,
      element_type: child.element_type,
      x: child.position.x,
      y: child.position.y,
      width: child.size.width,
      height: child.size.height,
    })),
    allowSlideMedia: flagBool(args, "allow-slide-media", false),
  });

  const sceneJson = serializeScene(scene) as Record<string, unknown>;
  const slidesArr = [...(sceneJson.slide_elements as Record<string, unknown>[])];
  const childrenArr = [...((slidesArr[slideIdx].children_elements as unknown[]) ?? [])];
  const at = flagNumber(args, "at");
  const insertAt = at === undefined
    ? childrenArr.length
    : Math.max(0, Math.min(Math.floor(at), childrenArr.length));
  childrenArr.splice(insertAt, 0, serializeElement(validated));
  slidesArr[slideIdx] = { ...slidesArr[slideIdx], children_elements: childrenArr };
  sceneJson.slide_elements = slidesArr;

  const { scene: validatedScene, warnings } = parseScene(sceneJson);
  await saveScene(session, validatedScene);

  const insertedSlide = validatedScene.slide_elements[slideIdx];
  printSuccess(
    maybeQuietMutationData(
      {
        slide_index: slideIdx,
        slide_id: insertedSlide.element_id,
        inserted_at: insertAt,
        element_id: validated.element_id,
        element: elementSummary(insertedSlide.children_elements[insertAt], insertAt),
        ...(asset ? { asset } : {}),
      },
      output.quiet,
    ),
    output,
    [
      ...compatWarnings,
      ...layoutWarnings,
      ...textQualityWarnings,
      ...svgWarnings,
      ...quizMediaWarnings,
      ...typographyNotes,
      ...warnings,
    ].length > 0
      ? [
          ...compatWarnings,
          ...layoutWarnings,
          ...textQualityWarnings,
          ...svgWarnings,
          ...quizMediaWarnings,
          ...typographyNotes,
          ...warnings,
        ]
      : undefined,
  );
};

export const handleElementUpdate = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  const { session, scene } = requireScene();
  const slideIdx = findSlideIndex(scene.slide_elements, args.positionals[0]);
  const slide = scene.slide_elements[slideIdx];
  const childIdx = findChildIndex(slide.children_elements, args.positionals[1]);
  const current = slide.children_elements[childIdx];

  const payload = buildElementPayload(args, "element update");
  if (Object.keys(payload).length === 0) {
    throw new AinobiCliError("USAGE", "Provide at least one change via --json, --set, or --name.");
  }
  if (payload.element_type !== undefined && payload.element_type !== current.element_type) {
    throw new AinobiCliError(
      "INVALID_INPUT",
      `element_type cannot be changed (current="${current.element_type}", requested="${String(payload.element_type)}").`,
      { hint: "Delete the element and insert a new one to change types." },
    );
  }

  let merged = deepMerge(serializeElement(current) as Record<string, unknown>, payload) as Record<string, unknown>;
  merged.element_id = current.element_id;
  if (current.element_type !== "group" && current.element_type !== "html") {
    delete merged.children_elements;
  } else {
    merged.children_elements =
      (merged.children_elements as unknown[] | undefined) ??
      ((current as { children_elements?: Element[] }).children_elements ?? []);
  }

  const typographyNotes: CliIssue[] = [];
  if (current.element_type === "text") {
    const normalized = normalizeTextElementRecord(merged);
    merged = normalized.record;
    if (normalized.promotions.length > 0) {
      typographyNotes.push({
        path: `slide[${slideIdx}].children_elements[${childIdx}]`,
        message:
          `Promoted ${normalized.promotions.join(", ")} from style to root text fields. ` +
          "Prefer --set color / font_size / line_height / bold / align; style.* aliases are copied to root on write.",
        value: { promotions: normalized.promotions },
      });
    }
  }

  const updateShape = normalizeElementShapeInput(merged);
  merged = updateShape.record;
  applyCanvasCenterFlags(merged, slide, args);
  const updateTiming = fillElementTimingGaps(merged);
  merged = updateTiming.record;
  const updateGaps = { fixes: [...updateShape.fixes, ...updateTiming.fixes] };
  if (updateGaps.fixes.length > 0) {
    typographyNotes.push({
      path: `slide[${slideIdx}].children_elements[${childIdx}]`,
      message: `Auto-fixed input: ${updateGaps.fixes.join("; ")}.`,
    });
  }

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
      align: validated.element_type === "text" ? validated.align : undefined,
    },
    { path: layoutPath, slideWidth: slide.size.width, slideHeight: slide.size.height },
  );

  const textQualityWarnings =
    validated.element_type === "text"
      ? collectTextElementQualityIssues(
          {
            element_id: validated.element_id,
            element_type: validated.element_type,
            name: validated.name,
            text: validated.text,
            font_size: validated.font_size,
            line_height: validated.line_height,
            size: validated.size,
          },
          { path: layoutPath },
        )
      : [];

  const svgWarnings: CliIssue[] =
    validated.element_type === "svg"
      ? collectSvgElementIssues(validated, {
          path: layoutPath,
          slideWidth: slide.size.width,
          slideHeight: slide.size.height,
        })
      : [];

  const quizMediaWarnings =
    validated.element_type === "image" || validated.element_type === "audio"
      ? collectQuizSlideMediaWarnings({
          slideIndex: slideIdx,
          elementType: validated.element_type,
          position: validated.position,
          size: validated.size,
          slideChildren: slide.children_elements
            .filter((_, i) => i !== childIdx)
            .map((child) => ({
              element_id: child.element_id,
              element_type: child.element_type,
              x: child.position.x,
              y: child.position.y,
              width: child.size.width,
              height: child.size.height,
            })),
          allowSlideMedia: flagBool(args, "allow-slide-media", false),
        })
      : [];

  const sceneJson = serializeScene(scene) as Record<string, unknown>;
  const slidesArr = [...(sceneJson.slide_elements as Record<string, unknown>[])];
  const childrenArr = [...((slidesArr[slideIdx].children_elements as unknown[]) ?? [])];
  childrenArr[childIdx] = serializeElement(validated);
  slidesArr[slideIdx] = { ...slidesArr[slideIdx], children_elements: childrenArr };
  sceneJson.slide_elements = slidesArr;

  const { scene: validatedScene, warnings } = parseScene(sceneJson);
  await saveScene(session, validatedScene);

  const updatedSlide = validatedScene.slide_elements[slideIdx];
  printSuccess(
    maybeQuietMutationData(
      {
        slide_index: slideIdx,
        slide_id: updatedSlide.element_id,
        element_index: childIdx,
        updated_fields: Object.keys(payload),
        element: elementSummary(updatedSlide.children_elements[childIdx], childIdx),
      },
      output.quiet,
    ),
    output,
    [...layoutWarnings, ...textQualityWarnings, ...svgWarnings, ...quizMediaWarnings, ...typographyNotes, ...warnings].length > 0
      ? [...layoutWarnings, ...textQualityWarnings, ...svgWarnings, ...quizMediaWarnings, ...typographyNotes, ...warnings]
      : undefined,
  );
};

export const handleElementDelete = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  const { scene } = requireScene();
  const slideIdx = findSlideIndex(scene.slide_elements, args.positionals[0]);
  const slide = scene.slide_elements[slideIdx];
  const childIdx = findChildIndex(slide.children_elements, args.positionals[1]);
  const removed = slide.children_elements[childIdx];

  await withSceneTransaction(args, output, (sceneJson) => {
    const result = applyOperation(sceneJson, {
      op: "element.delete",
      slide: args.positionals[0],
      element: args.positionals[1],
    });
    const slides = (sceneJson.slide_elements as Record<string, unknown>[]) ?? [];
    const nextSlide = slides[slideIdx] as Record<string, unknown> | undefined;
    const nextChildren = (nextSlide?.children_elements as unknown[] | undefined) ?? [];
    return {
      slide_index: slideIdx,
      slide_id: String(nextSlide?.element_id ?? slide.element_id),
      removed_index: childIdx,
      removed_element_id: removed.element_id,
      removed_element_type: removed.element_type,
      removed_question_ids: result.data.removed_question_ids ?? [],
      element_count: nextChildren.length,
    };
  });
};
