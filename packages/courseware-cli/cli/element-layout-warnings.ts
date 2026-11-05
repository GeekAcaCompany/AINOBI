// SPDX-License-Identifier: AGPL-3.0-only
import type { CliIssue } from "./errors.ts";

const TOLERANCE_PX = 2;
const CENTER_LINE_TOLERANCE_PX = 12;

export interface LayoutInspectableElement {
  element_id: string;
  element_type: string;
  name?: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  align?: string;
}

export interface ElementLayoutContext {
  path: string;
  slideWidth: number;
  slideHeight: number;
}

/** Warnings for common agent layout mistakes (canvas overflow, position.x = slide_width/2 trap). */
export const collectElementLayoutIssues = (
  element: LayoutInspectableElement,
  context: ElementLayoutContext,
): CliIssue[] => {
  const issues: CliIssue[] = [];
  const { path, slideWidth, slideHeight } = context;
  const { x, y } = element.position;
  const { width, height } = element.size;
  if (width <= 0 || height <= 0) return issues;

  const right = x + width;
  const bottom = y + height;
  const overflowsCanvas =
    x < -TOLERANCE_PX ||
    y < -TOLERANCE_PX ||
    right > slideWidth + TOLERANCE_PX ||
    bottom > slideHeight + TOLERANCE_PX;

  if (overflowsCanvas) {
    issues.push({
      path: `${path}.position`,
      message:
        `Element box extends past the slide canvas (${slideWidth}×${slideHeight}): ` +
        `left=${Math.round(x)}, top=${Math.round(y)}, right=${Math.round(right)}, bottom=${Math.round(bottom)}. ` +
        "position is the box top-left (0,0 = slide top-left).",
      value: { position: element.position, size: element.size },
    });
  }

  const slideCenterX = slideWidth / 2;
  const slideCenterY = slideHeight / 2;
  const suggestedX = Math.round((slideWidth - width) / 2);
  const suggestedY = Math.round((slideHeight - height) / 2);
  const nearCenterLineX = Math.abs(x - slideCenterX) <= CENTER_LINE_TOLERANCE_PX;
  const nearCenterLineY = Math.abs(y - slideCenterY) <= CENTER_LINE_TOLERANCE_PX;
  const align = element.align?.toLowerCase();

  if (
    nearCenterLineX &&
    Math.abs(x - suggestedX) > CENTER_LINE_TOLERANCE_PX &&
    (align === "center" || right > slideWidth + TOLERANCE_PX)
  ) {
    issues.push({
      path: `${path}.position.x`,
      message:
        `position.x=${Math.round(x)} is near the slide horizontal center line (${slideCenterX}), ` +
        "but position is the box top-left—not the visual center. " +
        `align only affects text inside the box. For horizontal centering use position.x=${suggestedX}, ` +
        "--center-x on insert, or ainobi element align <slide> --ids " +
        `${element.element_id} --mode slide-center-x.`,
      value: {
        position_x: x,
        suggested_x: suggestedX,
        size_width: width,
        slide_width: slideWidth,
      },
    });
  }

  if (
    nearCenterLineY &&
    Math.abs(y - suggestedY) > CENTER_LINE_TOLERANCE_PX &&
    bottom > slideHeight + TOLERANCE_PX
  ) {
    issues.push({
      path: `${path}.position.y`,
      message:
        `position.y=${Math.round(y)} is near the slide vertical center line (${slideCenterY}), ` +
        "but position is the box top-left. " +
        `For vertical centering use position.y=${suggestedY}, ` +
        "--center-y on insert, or ainobi element align … --mode slide-center-y.",
      value: {
        position_y: y,
        suggested_y: suggestedY,
        size_height: height,
        slide_height: slideHeight,
      },
    });
  }

  return issues;
};
