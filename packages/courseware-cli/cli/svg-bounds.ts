// SPDX-License-Identifier: AGPL-3.0-only
import type { CliIssue } from "./errors.ts";

const INLINE_SVG_PREFIX = /^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i;
const URL_SOURCE = /^https?:\/\//i;
const DATA_SVG = /^data:image\/svg\+xml/i;

const TOLERANCE_PX = 1;
const OVERFLOW_RATIO_WARN = 0.02;

export interface ViewBoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ContentBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SvgBoundsAnalysis {
  isInline: boolean;
  isRemote: boolean;
  viewBox: ViewBoxRect | null;
  rootWidth: number | null;
  rootHeight: number | null;
  contentBBox: ContentBBox | null;
  hasPaths: boolean;
  hasComplexGeometry: boolean;
}

const parseNumber = (value: string | undefined): number | null => {
  if (value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const attrFromTag = (tag: string, name: string): string | undefined => {
  const re = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i");
  const match = tag.match(re);
  return match?.[2];
};

const parseViewBoxAttr = (value: string | undefined): ViewBoxRect | null => {
  if (!value) return null;
  const parts = value.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x, y, width, height] = parts;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
};

const openSvgTag = (source: string): string | null => {
  const match = source.match(/<svg\b[^>]*>/i);
  return match?.[0] ?? null;
};

const expandBBox = (
  bbox: ContentBBox | null,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): ContentBBox => {
  if (!bbox) return { minX, minY, maxX, maxY };
  return {
    minX: Math.min(bbox.minX, minX),
    minY: Math.min(bbox.minY, minY),
    maxX: Math.max(bbox.maxX, maxX),
    maxY: Math.max(bbox.maxY, maxY),
  };
};

const strokePad = (tag: string): number => {
  const sw = parseNumber(attrFromTag(tag, "stroke-width"));
  if (sw === null || sw <= 0) return 0.5;
  return sw / 2;
};

const absorbCircle = (bbox: ContentBBox | null, tag: string): ContentBBox | null => {
  const cx = parseNumber(attrFromTag(tag, "cx"));
  const cy = parseNumber(attrFromTag(tag, "cy"));
  const r = parseNumber(attrFromTag(tag, "r"));
  if (cx === null || cy === null || r === null) return bbox;
  const pad = strokePad(tag);
  return expandBBox(bbox, cx - r - pad, cy - r - pad, cx + r + pad, cy + r + pad);
};

const absorbEllipse = (bbox: ContentBBox | null, tag: string): ContentBBox | null => {
  const cx = parseNumber(attrFromTag(tag, "cx"));
  const cy = parseNumber(attrFromTag(tag, "cy"));
  const rx = parseNumber(attrFromTag(tag, "rx"));
  const ry = parseNumber(attrFromTag(tag, "ry"));
  if (cx === null || cy === null || rx === null || ry === null) return bbox;
  const pad = strokePad(tag);
  return expandBBox(bbox, cx - rx - pad, cy - ry - pad, cx + rx + pad, cy + ry + pad);
};

const absorbRect = (bbox: ContentBBox | null, tag: string): ContentBBox | null => {
  const x = parseNumber(attrFromTag(tag, "x")) ?? 0;
  const y = parseNumber(attrFromTag(tag, "y")) ?? 0;
  const w = parseNumber(attrFromTag(tag, "width"));
  const h = parseNumber(attrFromTag(tag, "height"));
  if (w === null || h === null) return bbox;
  const pad = strokePad(tag);
  return expandBBox(bbox, x - pad, y - pad, x + w + pad, y + h + pad);
};

const absorbLine = (bbox: ContentBBox | null, tag: string): ContentBBox | null => {
  const x1 = parseNumber(attrFromTag(tag, "x1"));
  const y1 = parseNumber(attrFromTag(tag, "y1"));
  const x2 = parseNumber(attrFromTag(tag, "x2"));
  const y2 = parseNumber(attrFromTag(tag, "y2"));
  if (x1 === null || y1 === null || x2 === null || y2 === null) return bbox;
  const pad = strokePad(tag);
  return expandBBox(bbox, Math.min(x1, x2) - pad, Math.min(y1, y2) - pad, Math.max(x1, x2) + pad, Math.max(y1, y2) + pad);
};

const absorbPoints = (bbox: ContentBBox | null, tag: string): ContentBBox | null => {
  const raw = attrFromTag(tag, "points");
  if (!raw) return bbox;
  const nums = raw.trim().split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
  if (nums.length < 2) return bbox;
  let next = bbox;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = nums[i];
    const y = nums[i + 1];
    const pad = strokePad(tag);
    next = expandBBox(next, x - pad, y - pad, x + pad, y + pad);
  }
  return next;
};

const estimateContentBBox = (source: string): { bbox: ContentBBox | null; hasPaths: boolean; hasComplexGeometry: boolean } => {
  let bbox: ContentBBox | null = null;
  let hasPaths = false;
  let hasComplexGeometry = false;

  const circleRe = /<circle\b[^>]*\/?>/gi;
  const ellipseRe = /<ellipse\b[^>]*\/?>/gi;
  const rectRe = /<rect\b[^>]*\/?>/gi;
  const lineRe = /<line\b[^>]*\/?>/gi;
  const polyRe = /<poly(?:gon|line)\b[^>]*\/?>/gi;
  const pathRe = /<path\b[^>]*\/?>/gi;
  const textRe = /<text\b[^>]*>/gi;

  for (const match of source.matchAll(circleRe)) bbox = absorbCircle(bbox, match[0]);
  for (const match of source.matchAll(ellipseRe)) bbox = absorbEllipse(bbox, match[0]);
  for (const match of source.matchAll(rectRe)) bbox = absorbRect(bbox, match[0]);
  for (const match of source.matchAll(lineRe)) bbox = absorbLine(bbox, match[0]);
  for (const match of source.matchAll(polyRe)) bbox = absorbPoints(bbox, match[0]);
  if (source.match(pathRe)) hasPaths = true;
  if (source.match(textRe)) hasComplexGeometry = true;

  return { bbox, hasPaths, hasComplexGeometry };
};

export const isInlineSvgSource = (source: string): boolean => INLINE_SVG_PREFIX.test(source.trim());

export const isRemoteSvgSource = (source: string): boolean =>
  URL_SOURCE.test(source.trim()) || DATA_SVG.test(source.trim());

export const analyzeInlineSvgSource = (source: string): SvgBoundsAnalysis => {
  const trimmed = source.trim();
  const tag = openSvgTag(trimmed);
  const viewBox = parseViewBoxAttr(tag ? attrFromTag(tag, "viewBox") : undefined);
  const rootWidth = parseNumber(tag ? attrFromTag(tag, "width") : undefined);
  const rootHeight = parseNumber(tag ? attrFromTag(tag, "height") : undefined);
  const { bbox, hasPaths, hasComplexGeometry } = estimateContentBBox(trimmed);

  return {
    isInline: true,
    isRemote: false,
    viewBox,
    rootWidth,
    rootHeight,
    contentBBox: bbox,
    hasPaths,
    hasComplexGeometry: hasComplexGeometry || hasPaths,
  };
};

export const analyzeSvgSource = (source: string): SvgBoundsAnalysis => {
  if (isRemoteSvgSource(source)) {
    return {
      isInline: false,
      isRemote: true,
      viewBox: null,
      rootWidth: null,
      rootHeight: null,
      contentBBox: null,
      hasPaths: false,
      hasComplexGeometry: false,
    };
  }
  if (!isInlineSvgSource(source)) {
    return {
      isInline: false,
      isRemote: false,
      viewBox: null,
      rootWidth: null,
      rootHeight: null,
      contentBBox: null,
      hasPaths: false,
      hasComplexGeometry: false,
    };
  }
  return analyzeInlineSvgSource(source);
};

const nearlyEqual = (a: number, b: number, tolerance = TOLERANCE_PX): boolean => Math.abs(a - b) <= tolerance;

const coordSystem = (
  analysis: SvgBoundsAnalysis,
  elementWidth: number,
  elementHeight: number,
): ViewBoxRect => {
  if (analysis.viewBox) return analysis.viewBox;
  if (analysis.rootWidth !== null && analysis.rootHeight !== null) {
    return { x: 0, y: 0, width: analysis.rootWidth, height: analysis.rootHeight };
  }
  return { x: 0, y: 0, width: elementWidth, height: elementHeight };
};

const contentOverflows = (
  content: ContentBBox,
  box: ViewBoxRect,
): { overflows: boolean; axis: "x" | "y" | "both" | null; excessPx: number } => {
  const excessLeft = Math.max(0, box.x - content.minX);
  const excessTop = Math.max(0, box.y - content.minY);
  const excessRight = Math.max(0, content.maxX - (box.x + box.width));
  const excessBottom = Math.max(0, content.maxY - (box.y + box.height));
  const excessPx = Math.max(excessLeft, excessTop, excessRight, excessBottom);
  const overflows = excessPx > TOLERANCE_PX;
  const xOverflow = excessLeft > TOLERANCE_PX || excessRight > TOLERANCE_PX;
  const yOverflow = excessTop > TOLERANCE_PX || excessBottom > TOLERANCE_PX;
  const axis = xOverflow && yOverflow ? "both" : xOverflow ? "x" : yOverflow ? "y" : null;
  return { overflows, axis, excessPx };
};

export interface SvgElementContext {
  path: string;
  slideWidth: number;
  slideHeight: number;
}

export interface SvgInspectableElement {
  element_id: string;
  element_type: string;
  name?: string;
  // `source` is only required for `element_type === "svg"`; we accept a
  // wider input so callers can pass `SlideElement[].children_elements`
  // (whose union members do not all carry `source`) without casting.
  source?: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  preserve_aspect_ratio?: boolean;
}

export const collectSvgElementIssues = (
  element: SvgInspectableElement,
  context: SvgElementContext,
): CliIssue[] => {
  if (element.element_type !== "svg") return [];
  const issues: CliIssue[] = [];
  const { path, slideWidth, slideHeight } = context;
  const { width, height } = element.size;
  const source = element.source ?? "";

  if (width <= 0 || height <= 0) {
    issues.push({
      path: `${path}.size`,
      message: "SVG element size.width and size.height must be positive.",
      value: element.size,
    });
    return issues;
  }

  const right = element.position.x + width;
  const bottom = element.position.y + height;
  if (right > slideWidth + TOLERANCE_PX || bottom > slideHeight + TOLERANCE_PX) {
    issues.push({
      path: `${path}.position`,
      message:
        `SVG box extends past the slide canvas (${slideWidth}×${slideHeight}): ` +
        `right=${Math.round(right)}, bottom=${Math.round(bottom)}. Shrink size or move position.`,
      value: { position: element.position, size: element.size },
    });
  }

  const analysis = analyzeSvgSource(source);

  if (analysis.isRemote) {
    issues.push({
      path: `${path}.source`,
      message:
        "Remote SVG (URL) cannot be bounds-checked here. Export with viewBox matching element size, or use inline SVG in a JSON payload.",
    });
    return issues;
  }

  if (!analysis.isInline) {
    issues.push({
      path: `${path}.source`,
      message: "SVG source is empty or not recognizable inline <svg> markup.",
    });
    return issues;
  }

  const viewBoxHint = `viewBox="0 0 ${width} ${height}"`;

  if (!analysis.viewBox) {
    issues.push({
      path: `${path}.source`,
      message:
        `Inline SVG is missing viewBox. Set ${viewBoxHint} to match element size so the player scales coordinates predictably.`,
    });
  } else {
    const vb = analysis.viewBox;
    if (!nearlyEqual(vb.width, width) || !nearlyEqual(vb.height, height)) {
      issues.push({
        path: `${path}.source`,
        message:
          `viewBox user size (${vb.width}×${vb.height}) does not match element size (${width}×${height}). ` +
          `Prefer ${viewBoxHint} and draw geometry inside 0…${width} × 0…${height}.`,
        value: { viewBox: `${vb.x} ${vb.y} ${vb.width} ${vb.height}`, element_size: element.size },
      });
    }
    const aspectVb = vb.width / vb.height;
    const aspectEl = width / height;
    if (
      element.preserve_aspect_ratio !== false &&
      Math.abs(aspectVb - aspectEl) > 0.02
    ) {
      issues.push({
        path: `${path}.preserve_aspect_ratio`,
        message:
          `viewBox aspect ratio (${aspectVb.toFixed(3)}) differs from element size (${aspectEl.toFixed(3)}). ` +
          "With preserve_aspect_ratio=true the graphic may letterbox; align viewBox to size or set preserve_aspect_ratio=false intentionally.",
      });
    }
  }

  if (analysis.rootWidth !== null && !nearlyEqual(analysis.rootWidth, width)) {
    issues.push({
      path: `${path}.source`,
      message:
        `Root <svg width="${analysis.rootWidth}"> does not match element size.width (${width}). Omit width/height on <svg> and rely on viewBox + element size.`,
    });
  }
  if (analysis.rootHeight !== null && !nearlyEqual(analysis.rootHeight, height)) {
    issues.push({
      path: `${path}.source`,
      message:
        `Root <svg height="${analysis.rootHeight}"> does not match element size.height (${height}). Omit width/height on <svg> and rely on viewBox + element size.`,
    });
  }

  const coords = coordSystem(analysis, width, height);

  if (analysis.contentBBox) {
    const overflow = contentOverflows(analysis.contentBBox, coords);
    if (overflow.overflows) {
      const pct = Math.round((overflow.excessPx / Math.min(coords.width, coords.height)) * 100);
      issues.push({
        path: `${path}.source`,
        message:
          `SVG geometry extends ~${Math.round(overflow.excessPx)}px outside the coordinate box ` +
          `(${coords.width}×${coords.height}${analysis.viewBox ? " viewBox" : ""}). ` +
          `Content may clip or spill the element frame. Shrink coordinates/stroke or enlarge ${viewBoxHint}.`,
        value: { content_bbox: analysis.contentBBox, excess_px: overflow.excessPx, approx_pct: pct },
      });
    } else {
      const spanW = analysis.contentBBox.maxX - analysis.contentBBox.minX;
      const spanH = analysis.contentBBox.maxY - analysis.contentBBox.minY;
      const fillW = spanW / coords.width;
      const fillH = spanH / coords.height;
      if (fillW > 1 - OVERFLOW_RATIO_WARN && fillH > 1 - OVERFLOW_RATIO_WARN) {
        const touchesEdge =
          analysis.contentBBox.minX <= coords.x + TOLERANCE_PX ||
          analysis.contentBBox.minY <= coords.y + TOLERANCE_PX ||
          analysis.contentBBox.maxX >= coords.x + coords.width - TOLERANCE_PX ||
          analysis.contentBBox.maxY >= coords.y + coords.height - TOLERANCE_PX;
        if (touchesEdge) {
          issues.push({
            path: `${path}.source`,
            message:
              "SVG content fills the coordinate box edge-to-edge; stroke or anti-aliasing may clip. Leave ~2–4px padding inside viewBox.",
          });
        }
      }
    }
  }

  if (analysis.hasComplexGeometry && !analysis.viewBox) {
    issues.push({
      path: `${path}.source`,
      message:
        "SVG contains paths or text without viewBox; bounds cannot be verified reliably. Add an explicit viewBox matching element size.",
    });
  }

  if (analysis.hasPaths && analysis.viewBox && analysis.contentBBox === null) {
    issues.push({
      path: `${path}.source`,
      message:
        "SVG contains <path> elements; automatic bounds check is partial only. Confirm paths stay inside viewBox.",
    });
  }

  return issues;
};

export const collectSceneSvgIssues = (
  slideElements: Array<{
    element_id: string;
    size: { width: number; height: number };
    children_elements: SvgInspectableElement[];
  }>,
): CliIssue[] => {
  const issues: CliIssue[] = [];
  slideElements.forEach((slide, slideIndex) => {
    slide.children_elements.forEach((child, childIndex) => {
      if (child.element_type !== "svg") return;
      const path = `slide_elements[${slideIndex}].children_elements[${childIndex}]`;
      issues.push(
        ...collectSvgElementIssues(
          child,
          {
            path: `${path} (${child.element_id})`,
            slideWidth: slide.size.width,
            slideHeight: slide.size.height,
          },
        ),
      );
    });
  });
  return issues;
};

export const svgBoundsReportEntry = (
  slideIndex: number,
  slideId: string,
  childIndex: number,
  element: SvgInspectableElement,
  slideSize: { width: number; height: number },
): Record<string, unknown> => {
  const analysis = analyzeSvgSource(element.source ?? "");
  const issues = collectSvgElementIssues(element, {
    path: `slide_elements[${slideIndex}].children_elements[${childIndex}]`,
    slideWidth: slideSize.width,
    slideHeight: slideSize.height,
  });
  return {
    slide_index: slideIndex,
    slide_id: slideId,
    element_index: childIndex,
    element_id: element.element_id,
    name: element.name,
    size: element.size,
    position: element.position,
    preserve_aspect_ratio: element.preserve_aspect_ratio ?? true,
    analysis: {
      has_viewBox: Boolean(analysis.viewBox),
      viewBox: analysis.viewBox,
      content_bbox: analysis.contentBBox,
      has_paths: analysis.hasPaths,
      is_remote: analysis.isRemote,
    },
    issue_count: issues.length,
    issues,
  };
};
