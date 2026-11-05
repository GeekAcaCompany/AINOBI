// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { collectContentOverlapWarnings } from "../content-overlap-warnings.ts";
import { hasVisiblePixels } from "../element-visibility.ts";
import type { ParsedArgs } from "../args.ts";
import { flagBool, flagNumber } from "../args.ts";
import { AinobiCliError, type CliIssue } from "../errors.ts";
import { readJsonFile } from "../input.ts";
import { findSlideIndexInJson } from "../operations.ts";
import { printSuccess, type OutputOptions } from "../output.ts";
import { requireScene } from "../state.ts";
import { coursewareAssetUrlPrefixes, isAllowedCoursewareAssetUrl } from "../url-policy.ts";
import { extractSignableFilePathFromUrl } from "@ainobi/courseware-core/asset-url-normalize.ts";
import { collectDuplicateElementIdIssues } from "../scene-integrity.ts";
import { collectSceneSvgIssues, svgBoundsReportEntry } from "../svg-bounds.ts";
import { isLikelyQuizMediaMisplacementOverlap } from "../element-quiz-media-warnings.ts";
import { collectSlidesWithNoMotionWarnings } from "../slide-motion-warnings.ts";
import { collectHtmlQuizSlideSpanWarnings } from "../element-slide-span-warnings.ts";
import { collectLowTextContrastWarnings } from "../text-contrast-warnings.ts";
import { collectSceneTextQualityWarnings } from "../text-quality-warnings.ts";
import { collectTextTypographyDriftWarnings } from "../text-element-normalize.ts";
import { parseScene } from "../validate.ts";
import {
  collectSignableUrlsForPresign,
  serializeScene,
  validateQuizConfig,
  validateQuizSlideBindings,
  collectQuizLayoutSizingWarnings,
  collectNarrationTimelineOverlapWarnings,
  type Element,
  type Scene,
  NarrationElement,
} from "@ainobi/courseware-core";

const walkElements = (elements: Element[], visit: (element: Element, slideIndex?: number) => void, slideIndex?: number): void => {
  for (const element of elements) {
    visit(element, slideIndex);
    if ("children_elements" in element && Array.isArray(element.children_elements)) {
      walkElements(element.children_elements, visit, slideIndex);
    }
  }
};

interface TimelineInterval {
  start_at: number;
  end_at: number;
}

const mergeIntervals = (intervals: TimelineInterval[]): TimelineInterval[] => {
  const sorted = intervals
    .filter((interval) => interval.end_at > interval.start_at)
    .sort((a, b) => a.start_at - b.start_at || a.end_at - b.end_at);
  const merged: TimelineInterval[] = [];
  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || interval.start_at > previous.end_at) {
      merged.push({ ...interval });
    } else {
      previous.end_at = Math.max(previous.end_at, interval.end_at);
    }
  }
  return merged;
};

const narrationDurationMs = (slide: Scene["slide_elements"][number]): number | null => {
  const elements = slide.children_elements as NarrationElement[];
  const durations = elements
    .filter((element) => element.element_type === "narration")
    .map((element) => element.segments.reduce((sum, segment) => sum + segment.duration_ms + segment.gap_ms, 0))
    .filter((duration) => duration > 0);
  if (durations.length === 0) return null;
  return Math.max(...durations);
};

const buildTimelineCoverage = (
  scene: Scene,
  options: { minGapMs: number; tailThresholdMs: number },
): { coverage: Record<string, unknown>[]; warnings: CliIssue[] } => {
  const warnings: CliIssue[] = [];
  const coverage = scene.slide_elements.map((slide, slideIndex) => {
    const slideStart = slide.timeline.start_at;
    const slideEnd = slide.timeline.end_at;
    const visualIntervals = slide.children_elements
      .filter(hasVisiblePixels)
      .map((element: Element) => ({
        start_at: Math.max(slideStart, element.timeline.start_at),
        end_at: Math.min(slideEnd, element.timeline.end_at),
      }));
    const merged = mergeIntervals(visualIntervals);
    const emptyGaps: TimelineInterval[] = [];
    let cursor = slideStart;
    for (const interval of merged) {
      if (interval.start_at - cursor >= options.minGapMs) {
        emptyGaps.push({ start_at: cursor, end_at: interval.start_at });
      }
      cursor = Math.max(cursor, interval.end_at);
    }
    if (slideEnd - cursor >= options.minGapMs) {
      emptyGaps.push({ start_at: cursor, end_at: slideEnd });
    }

    const visualStart = merged[0]?.start_at ?? null;
    const visualEnd = merged.length > 0 ? merged[merged.length - 1].end_at : null;
    const visualIdleTail = visualEnd === null ? slideEnd - slideStart : Math.max(0, slideEnd - visualEnd);
    const narrationDuration = narrationDurationMs(slide);
    const narrationIdleTail = narrationDuration === null ? null : Math.max(0, slideEnd - slideStart - narrationDuration);

    if (emptyGaps.length > 0) {
      warnings.push({
        path: `slide_elements[${slideIndex}].timeline`,
        message: `Slide has ${emptyGaps.length} visual coverage gap(s).`,
      });
    }
    if (visualIdleTail >= options.tailThresholdMs) {
      warnings.push({
        path: `slide_elements[${slideIndex}].timeline`,
        message: `Slide has ${visualIdleTail}ms of visual idle tail.`,
      });
    }
    if (narrationIdleTail !== null && narrationIdleTail >= options.tailThresholdMs) {
      warnings.push({
        path: `slide_elements[${slideIndex}].timeline`,
        message: `Slide has ${narrationIdleTail}ms after synthesized narration ends.`,
      });
    }
    if (narrationDuration === null && slide.children_elements.some((element: Element) => element.element_type === "narration")) {
      warnings.push({
        path: `slide_elements[${slideIndex}].children_elements`,
        message: "Slide narration has no segment durations; audio-to-slide fit cannot be checked.",
      });
    }

    return {
      slide_index: slideIndex,
      slide_id: slide.element_id,
      slide_duration_ms: slideEnd - slideStart,
      visual_start_at: visualStart,
      visual_end_at: visualEnd,
      visual_idle_tail_ms: visualIdleTail,
      narration_duration_ms: narrationDuration,
      narration_idle_tail_ms: narrationIdleTail,
      empty_gaps: emptyGaps,
      visible_interval_count: merged.length,
    };
  });
  return { coverage, warnings };
};

const isInlineOrLocalSource = (value: string): boolean => {
  const trimmed = value.trim();
  return (
    !trimmed ||
    trimmed.startsWith("<svg") ||
    trimmed.startsWith("data:text/html") ||
    trimmed.startsWith("data:image/svg+xml") ||
    trimmed.startsWith("/")
  );
};

const addAssetUrlIssue = (
  issues: CliIssue[],
  path: string,
  value: string | undefined,
): void => {
  if (!value || isInlineOrLocalSource(value) || isAllowedCoursewareAssetUrl(value)) return;
  // Bare storage keys (raw/mp3/…, public/… etc.) are the unified persisted form since 2026-09-07:
  // at load time the presign machinery dispatches on the key prefix (public bucket compat echo / private bucket presign);
  // they are not external links — do not flag them against the URL allowlist (or publish validation breaks once scenes store bare keys).
  if (!/^https?:\/\//i.test(value.trim()) && extractSignableFilePathFromUrl(value)) return;
  issues.push({
    path,
    message: `External courseware asset URL must start with one of: ${coursewareAssetUrlPrefixes().join(", ")}.`,
    value,
  });
};

const collectAssetUrlIssues = (scene: Scene): CliIssue[] => {
  const issues: CliIssue[] = [];
  scene.slide_elements.forEach((slide, slideIndex) => {
    addAssetUrlIssue(
      issues,
      `slide_elements[${slideIndex}].background_image_url`,
      slide.background_image_url,
    );
    walkElements(slide.children_elements, (element) => {
      const elementPath = `slide_elements[${slideIndex}].${element.element_id}`;
      switch (element.element_type) {
        case "audio":
        case "image":
        case "video":
        case "svg":
          addAssetUrlIssue(issues, `${elementPath}.source`, element.source);
          break;
        case "html":
        case "ppt":
          addAssetUrlIssue(issues, `${elementPath}.src`, element.src);
          break;
        case "narration":
          element.segments.forEach((segment, segmentIndex) => {
            addAssetUrlIssue(
              issues,
              `${elementPath}.segments[${segmentIndex}].audio_url`,
              segment.audio_url,
            );
          });
          break;
        default:
          break;
      }
    }, slideIndex);
  });
  return issues;
};

const publishIssues = (scene: Scene): CliIssue[] => {
  const issues: CliIssue[] = [];
  if (scene.slide_elements.length === 0) {
    issues.push({ path: "slide_elements", message: "Scene must contain at least one slide." });
  }
  if (scene.quiz) {
    issues.push(
      ...validateQuizConfig(scene.quiz).map((issue) => ({
        path: issue.path,
        message: issue.message,
      })),
    );
  }
  issues.push(...collectAssetUrlIssues(scene));
  scene.slide_elements.forEach((slide, slideIndex) => {
    const ids = new Set<string>([slide.element_id]);
    walkElements(slide.children_elements, (element) => {
      ids.add(element.element_id);
      if (element.timeline.end_at > slide.timeline.end_at) {
        issues.push({ path: `slide_elements[${slideIndex}].${element.element_id}.timeline`, message: "Element timeline exceeds slide duration." });
      }
    }, slideIndex);
  });
  return issues;
};

export const handleValidate = (args: ParsedArgs, output: OutputOptions): void => {
  const { scene } = requireScene();
  const { warnings } = parseScene(serializeScene(scene));
  const svgWarnings = collectSceneSvgIssues(scene.slide_elements);
  const motionWarnings = collectSlidesWithNoMotionWarnings(scene);
  const htmlQuizSpanWarnings = collectHtmlQuizSlideSpanWarnings(scene);
  const typographyDriftWarnings = collectTextTypographyDriftWarnings(scene);
  const contrastWarnings = collectLowTextContrastWarnings(scene);
  const textQualityWarnings = collectSceneTextQualityWarnings(scene);
  const contentOverlapWarnings = collectContentOverlapWarnings(scene.slide_elements);
  const narrationOverlapWarnings = collectNarrationTimelineOverlapWarnings(scene).map((issue) => ({
    path: issue.path,
    message: issue.message,
    value: issue.value,
  }));
  const allWarnings = [
    ...contentOverlapWarnings,
    ...warnings,
    ...svgWarnings,
    ...motionWarnings,
    ...htmlQuizSpanWarnings,
    ...typographyDriftWarnings,
    ...contrastWarnings,
    ...textQualityWarnings,
    ...narrationOverlapWarnings,
    ...(scene.quiz ? collectQuizLayoutSizingWarnings(scene.quiz).map((issue) => ({
      path: issue.path,
      message: issue.message,
    })) : []),
  ];
  const quizCanvasIssues =
    scene.quiz && scene.quiz.questions.length > 0
      ? validateQuizSlideBindings(scene.quiz, scene.slide_elements).map((issue) => ({
          path: issue.path,
          message: issue.message,
        }))
      : [];
  const issues = [
    ...collectDuplicateElementIdIssues(scene),
    ...quizCanvasIssues,
    ...(flagBool(args, "publish", false) ? publishIssues(scene) : []),
  ];
  printSuccess(
    {
      valid: allWarnings.length === 0 && issues.length === 0,
      warning_count: allWarnings.length,
      svg_warning_count: svgWarnings.length,
      no_motion_slide_count: motionWarnings.length,
      text_typography_drift_count: typographyDriftWarnings.length,
      low_contrast_text_count: contrastWarnings.length,
      content_overlap_count: contentOverlapWarnings.length,
      text_quality_warning_count: textQualityWarnings.length,
      issue_count: issues.length,
      issues,
    },
    output,
    allWarnings,
  );
};

export const handleInspectTimeline = (args: ParsedArgs, output: OutputOptions): void => {
  const { scene } = requireScene();
  const includeCoverage = flagBool(args, "coverage", false);
  const coverageResult = includeCoverage
    ? buildTimelineCoverage(scene, {
        minGapMs: Math.max(0, flagNumber(args, "min-gap-ms") ?? 500),
        tailThresholdMs: Math.max(0, flagNumber(args, "tail-threshold-ms") ?? 1000),
      })
    : null;
  printSuccess(
    {
      slides: scene.slide_elements.map((slide, slideIndex) => ({
        index: slideIndex,
        element_id: slide.element_id,
        name: slide.name,
        timeline: slide.timeline,
        flow_pause_points: slide.flow_pause_points?.length ?? 0,
        children: slide.children_elements.map((element: Element, elementIndex: number) => ({
          index: elementIndex,
          element_id: element.element_id,
          element_type: element.element_type,
          name: element.name,
          timeline: element.timeline,
          keyframes: element.keyframes.length,
          animations: element.animations.length,
          highlights: element.highlight_segments?.length ?? 0,
        })),
      })),
      ...(coverageResult ? { coverage: coverageResult.coverage } : {}),
    },
    output,
    coverageResult?.warnings,
  );
};

export const handleInspectSvgBounds = (args: ParsedArgs, output: OutputOptions): void => {
  const { scene } = requireScene();
  const slideRef = args.positionals[0];
  let slideIndexes = scene.slide_elements.map((_slide, index) => index);
  if (slideRef !== undefined && slideRef !== "") {
    const sceneJson = serializeScene(scene) as Record<string, unknown>;
    slideIndexes = [findSlideIndexInJson(sceneJson, slideRef)];
  }

  const entries: Record<string, unknown>[] = [];
  for (const slideIndex of slideIndexes) {
    const slide = scene.slide_elements[slideIndex];
    slide.children_elements.forEach((child: Element, childIndex: number) => {
      if (child.element_type !== "svg") return;
      entries.push(
        svgBoundsReportEntry(slideIndex, slide.element_id, childIndex, child, slide.size),
      );
    });
  }

  const issueCount = entries.reduce((sum, row) => sum + Number(row.issue_count ?? 0), 0);
  const warnings = collectSceneSvgIssues(scene.slide_elements).filter((issue) => {
    if (slideIndexes.length === scene.slide_elements.length) return true;
    const slideIndex = slideIndexes[0];
    return issue.path.startsWith(`slide_elements[${slideIndex}].`);
  });

  printSuccess(
    {
      slide_indexes: slideIndexes,
      svg_element_count: entries.length,
      issue_count: issueCount,
      elements: entries,
    },
    output,
    warnings.length > 0 ? warnings : undefined,
  );
};

export const handleInspectOverlaps = (args: ParsedArgs, output: OutputOptions): void => {
  const { scene } = requireScene();
  const sceneJson = serializeScene(scene) as Record<string, unknown>;
  const slideIndex = findSlideIndexInJson(sceneJson, args.positionals[0]);
  const slide = scene.slide_elements[slideIndex];
  const visible = slide.children_elements.filter((element: Element) => element.size.width > 0 && element.size.height > 0);
  const overlaps: Record<string, unknown>[] = [];
  for (let i = 0; i < visible.length; i += 1) {
    for (let j = i + 1; j < visible.length; j += 1) {
      const a = visible[i];
      const b = visible[j];
      const left = Math.max(a.position.x, b.position.x);
      const top = Math.max(a.position.y, b.position.y);
      const right = Math.min(a.position.x + a.size.width, b.position.x + b.size.width);
      const bottom = Math.min(a.position.y + a.size.height, b.position.y + b.size.height);
      if (right > left && bottom > top) {
        const entry: Record<string, unknown> = {
          a: a.element_id,
          b: b.element_id,
          area: Math.round((right - left) * (bottom - top)),
        };
        if (isLikelyQuizMediaMisplacementOverlap(a, b)) {
          entry.likely_quiz_media_misplacement = true;
          entry.hint =
            "Slide image/audio overlapping a quiz frame usually belongs inside the question as <QuizMedia> (quiz update --jsx-file), not element insert.";
        }
        overlaps.push(entry);
      }
    }
  }
  printSuccess({ slide_index: slideIndex, overlap_count: overlaps.length, overlaps }, output);
};

export const handleInspectAssets = (_args: ParsedArgs, output: OutputOptions): void => {
  const { scene } = requireScene();
  printSuccess(
    {
      urls: collectSignableUrlsForPresign(scene),
    },
    output,
  );
};

const readSceneSummary = (path: string): { raw: unknown; slide_count: number; name: string } => {
  const raw = readJsonFile(path);
  const { scene } = parseScene(raw);
  return { raw, slide_count: scene.slide_elements.length, name: scene.name };
};

export const handleDiff = (args: ParsedArgs, output: OutputOptions): void => {
  const beforePath = args.positionals[0];
  const afterPath = args.positionals[1];
  if (!beforePath || !afterPath) {
    throw new AinobiCliError("USAGE", "Usage: ainobi diff <before.json> <after.json>.");
  }
  const before = readSceneSummary(beforePath);
  const after = readSceneSummary(afterPath);
  const beforeText = readFileSync(beforePath, "utf-8");
  const afterText = readFileSync(afterPath, "utf-8");
  printSuccess(
    {
      before: { path: beforePath, name: before.name, slide_count: before.slide_count, bytes: beforeText.length },
      after: { path: afterPath, name: after.name, slide_count: after.slide_count, bytes: afterText.length },
      changed: JSON.stringify(before.raw) !== JSON.stringify(after.raw),
      slide_count_delta: after.slide_count - before.slide_count,
      byte_delta: afterText.length - beforeText.length,
    },
    output,
  );
};

