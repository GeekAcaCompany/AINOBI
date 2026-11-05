// SPDX-License-Identifier: AGPL-3.0-only
import { resolve } from "node:path";

import {
  buildReferenceSceneBrief,
  referenceBriefPathFromScenePath,
  type ReferenceSceneBrief,
} from "@ainobi/courseware-core/reference-scene-brief.ts";
import type { Element } from "@ainobi/courseware-core";
import { serializeElement } from "@ainobi/courseware-core";
import { flagBool, flagNumber, flagString, type ParsedArgs } from "../args.ts";
import { compactLargeStrings } from "../compact-json-output.ts";
import { AinobiCliError } from "../errors.ts";
import { readJsonFile } from "../input.ts";
import { parseScene } from "../validate.ts";
import { printSuccess, type OutputOptions } from "../output.ts";
import {
  importReferenceSlidesIntoScene,
  parseReferenceSlideSelection,
} from "../reference-import.ts";
import {
  loadReferenceScene,
  referenceSceneSummary,
  referenceSlideSummary,
  resolveReferenceScenePath,
} from "../reference-scene-io.ts";
import { withSceneTransaction } from "../transaction.ts";
import {
  elementSummary,
  findChildIndex,
  findSlideIndex,
} from "./element.ts";
import { serializeScene } from "@ainobi/courseware-core";

function resolveReferenceInspectPath(args: ParsedArgs): string {
  const positional = args.positionals[0]?.trim();
  const fileFlag = flagString(args, "file")?.trim();
  const path = fileFlag || positional;
  if (!path) {
    throw new AinobiCliError(
      "USAGE",
      "Specify a staged reference path.",
      {
        hint:
          "Examples: `ainobi reference inspect ./reference/foo.brief.json` or `ainobi reference slide list ./reference/foo.scene.json`.",
      },
    );
  }
  return resolve(path);
}

function loadReferenceBrief(path: string): ReferenceSceneBrief {
  const lower = path.toLowerCase();
  if (lower.endsWith(".brief.json")) {
    const raw = readJsonFile(path);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new AinobiCliError("INVALID_INPUT", "Reference brief must be a JSON object.");
    }
    return raw as ReferenceSceneBrief;
  }

  const briefSibling = referenceBriefPathFromScenePath(path);
  try {
    const siblingRaw = readJsonFile(briefSibling);
    if (siblingRaw && typeof siblingRaw === "object" && !Array.isArray(siblingRaw)) {
      return siblingRaw as ReferenceSceneBrief;
    }
  } catch {
    // fall through to scene parse
  }

  const raw = readJsonFile(path);
  const { scene } = parseScene(raw, { allowSkip: true });
  return buildReferenceSceneBrief(scene as unknown as Record<string, unknown>);
}

function resolveBriefSlideIndex(brief: ReferenceSceneBrief, ref: string | undefined): number {
  if (ref === undefined || ref === "") {
    throw new AinobiCliError("USAGE", "Missing slide reference (index or element_id).");
  }
  if (/^-?\d+$/.test(ref)) {
    const idx = Number(ref);
    if (idx < 0 || idx >= brief.slides.length) {
      throw new AinobiCliError(
        "NOT_FOUND",
        `Slide index ${idx} is out of range (0..${brief.slides.length - 1}).`,
      );
    }
    return idx;
  }
  const idx = brief.slides.findIndex((slide) => slide.element_id === ref);
  if (idx < 0) {
    throw new AinobiCliError("NOT_FOUND", `Slide not found: "${ref}".`);
  }
  return idx;
}

/** Quick overview: prefer the `.brief.json` the host generated. */
export const handleReferenceInspect = (args: ParsedArgs, output: OutputOptions): void => {
  const path = resolveReferenceInspectPath(args);
  const brief = loadReferenceBrief(path);
  const slideRef = flagString(args, "slide") ?? args.positionals[1];
  const verbose = flagBool(args, "verbose", false);

  if (slideRef !== undefined && slideRef !== "") {
    const idx = resolveBriefSlideIndex(brief, slideRef);
    const slide = brief.slides[idx]!;
    printSuccess(
      verbose
        ? { index: idx, slide, source_path: path }
        : {
            index: idx,
            slide: {
              element_id: slide.element_id,
              name: slide.name,
              background_color: slide.background_color,
              has_background_image: slide.has_background_image,
              timeline: slide.timeline,
              children_count: slide.children_count,
              children: slide.children.map((child) => ({
                index: child.index,
                element_type: child.element_type,
                name: child.name,
                position: child.position,
                size: child.size,
                text_preview: child.text_preview,
                background_color: child.background_color,
                color: child.color,
                font_size: child.font_size,
              })),
              children_truncated: slide.children_truncated,
            },
            source_path: path,
            hint: "For full element payloads use `ainobi reference slide get <scene.json> <slide> --with-children`.",
          },
      output,
    );
    return;
  }

  printSuccess(
    {
      slide_count: brief.slide_count,
      scene_id: brief.scene_id,
      name: brief.name,
      source_path: path,
      slides: brief.slides.map((slide) =>
        verbose
          ? slide
          : {
              index: slide.index,
              element_id: slide.element_id,
              name: slide.name,
              background_color: slide.background_color,
              children_count: slide.children_count,
            },
      ),
      hint: "Use `ainobi reference slide list|get` and `reference element list|get` on the `.scene.json` path for finer inspection.",
    },
    output,
  );
};

export const handleReferenceSceneInfo = (args: ParsedArgs, output: OutputOptions): void => {
  const path = resolveReferenceScenePath(args, 0);
  const scene = loadReferenceScene(path);
  const verbose = flagBool(args, "verbose", false);
  printSuccess(
    verbose
      ? {
          ...referenceSceneSummary(scene),
          source_path: path,
          slides: scene.slide_elements.map((slide, index) => ({
            index,
            element_id: slide.element_id,
            name: slide.name,
          })),
        }
      : { ...referenceSceneSummary(scene), source_path: path },
    output,
  );
};

export const handleReferenceSlideList = (args: ParsedArgs, output: OutputOptions): void => {
  const path = resolveReferenceScenePath(args, 0);
  const scene = loadReferenceScene(path);
  const verbose = flagBool(args, "verbose", false);
  printSuccess(
    {
      source_path: path,
      slide_count: scene.slide_elements.length,
      slides: scene.slide_elements.map((slide, index) =>
        verbose
          ? {
              ...referenceSlideSummary(slide, index),
              children: slide.children_elements.map((child, ci) => ({
                index: ci,
                element_id: child.element_id,
                element_type: child.element_type,
                name: child.name,
              })),
            }
          : referenceSlideSummary(slide, index),
      ),
    },
    output,
  );
};

export const handleReferenceSlideGet = (args: ParsedArgs, output: OutputOptions): void => {
  const path = resolveReferenceScenePath(args, 0);
  const scene = loadReferenceScene(path);
  const slideRef = args.positionals[1];
  const idx = findSlideIndex(scene.slide_elements, slideRef);
  const slide = scene.slide_elements[idx]!;
  const includeChildren = flagBool(args, "with-children", false);
  const fullChildren = flagBool(args, "full-children", false);
  const serialized = serializeElement(slide) as Record<string, unknown>;
  let slidePayload: Record<string, unknown> = { ...serialized };
  if (!includeChildren) {
    delete slidePayload.children_elements;
    printSuccess(
      {
        source_path: path,
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
  printSuccess({ source_path: path, index: idx, slide: slidePayload }, output);
};

export const handleReferenceElementList = (args: ParsedArgs, output: OutputOptions): void => {
  const path = resolveReferenceScenePath(args, 0);
  const scene = loadReferenceScene(path);
  const slideRef = args.positionals[1];
  const idx = findSlideIndex(scene.slide_elements, slideRef);
  const slide = scene.slide_elements[idx]!;
  const verbose = flagBool(args, "verbose", false);
  const fullElements = flagBool(args, "full-elements", false);
  printSuccess(
    {
      source_path: path,
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

export const handleReferenceElementGet = (args: ParsedArgs, output: OutputOptions): void => {
  const path = resolveReferenceScenePath(args, 0);
  const scene = loadReferenceScene(path);
  const slideRef = args.positionals[1];
  const elementRef = args.positionals[2];
  const slideIdx = findSlideIndex(scene.slide_elements, slideRef);
  const slide = scene.slide_elements[slideIdx]!;
  const childIdx = findChildIndex(slide.children_elements, elementRef);
  const fullElement = flagBool(args, "full", false);
  const element = serializeElement(slide.children_elements[childIdx]!) as Record<string, unknown>;
  printSuccess(
    {
      source_path: path,
      slide_index: slideIdx,
      slide_id: slide.element_id,
      element_index: childIdx,
      element: fullElement ? element : (compactLargeStrings(element, {}) as Record<string, unknown>),
    },
    output,
  );
};

/**
 * Import one / several / all pages of a reference courseware into the current editing session (element_ids regenerated; quiz questions cloned too).
 *
 * Usage:
 *   ainobi reference import ./reference/foo.scene.json --slides all
 *   ainobi reference import ./reference/foo.scene.json --slides 0,2-4 --at 1
 *   ainobi reference import ./reference/foo.scene.json 0
 */
export const handleReferenceImport = async (
  args: ParsedArgs,
  output: OutputOptions,
): Promise<void> => {
  const path = resolveReferenceScenePath(args, 0);
  const referenceScene = loadReferenceScene(path);
  const refSerialized = serializeScene(referenceScene) as unknown as Record<string, unknown>;
  const selectionRaw =
    flagString(args, "slides") ?? flagString(args, "slide") ?? args.positionals[1] ?? "all";
  const at = flagNumber(args, "at");

  await withSceneTransaction(args, output, (targetScene) => {
    const refSlides = Array.isArray(refSerialized.slide_elements)
      ? (refSerialized.slide_elements as Record<string, unknown>[])
      : [];
    const indices = parseReferenceSlideSelection(selectionRaw, refSlides.length, (ref) => {
      const idx = refSlides.findIndex((slide) => slide.element_id === ref);
      return idx >= 0 ? idx : null;
    });
    return importReferenceSlidesIntoScene({
      targetScene,
      referenceScene: refSerialized,
      sourcePath: path,
      slideIndices: indices,
      at,
    });
  });
};
