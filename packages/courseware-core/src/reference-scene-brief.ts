// SPDX-License-Identifier: AGPL-3.0-only
/** Readable summary of a host-staged reference courseware (for agent Read / `ainobi reference inspect`). */

export type ReferenceElementBrief = {
  index: number;
  element_id?: string;
  element_type: string;
  name?: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  z_index?: number;
  text_preview?: string;
  background_color?: string;
  color?: string;
  font_size?: number;
  font_weight?: string | number;
  has_background_image?: boolean;
  html_note?: string;
};

export type ReferenceSlideBrief = {
  index: number;
  element_id?: string;
  name: string;
  background_color?: string;
  has_background_image?: boolean;
  timeline?: { start_at: number; end_at: number };
  children_count: number;
  children: ReferenceElementBrief[];
  children_truncated?: boolean;
};

export type ReferenceSceneBrief = {
  scene_id?: string;
  name?: string;
  slide_count: number;
  slides: ReferenceSlideBrief[];
  /** Aggregated visual tokens when `styleOnly` extraction is requested. */
  style_signals?: {
    colors: string[];
    background_colors: string[];
    font_sizes: number[];
    element_types: Record<string, number>;
  };
};

export type BuildReferenceSceneBriefOptions = {
  maxChildrenPerSlide?: number;
  /** Omit lesson copy and topical labels — for design-template extraction only. */
  styleOnly?: boolean;
};

const DEFAULT_MAX_CHILDREN_PER_SLIDE = 40;
const TEXT_PREVIEW_MAX = 80;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readTextPreview(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return undefined;
  return trimmed.length > TEXT_PREVIEW_MAX ? `${trimmed.slice(0, TEXT_PREVIEW_MAX)}…` : trimmed;
}

function readBox(
  rec: Record<string, unknown>,
  key: "position" | "size",
): { x?: number; y?: number; width?: number; height?: number } | undefined {
  const box = asRecord(rec[key]);
  if (!box) return undefined;
  if (key === "position") {
    const x = typeof box.x === "number" ? box.x : undefined;
    const y = typeof box.y === "number" ? box.y : undefined;
    if (x === undefined && y === undefined) return undefined;
    return { x, y };
  }
  const width = typeof box.width === "number" ? box.width : undefined;
  const height = typeof box.height === "number" ? box.height : undefined;
  if (width === undefined && height === undefined) return undefined;
  return { width, height };
}

function summarizeChildElement(
  child: unknown,
  index: number,
  options?: Pick<BuildReferenceSceneBriefOptions, "styleOnly">,
): ReferenceElementBrief | null {
  const rec = asRecord(child);
  if (!rec) return null;
  const styleOnly = options?.styleOnly === true;
  const element_type =
    typeof rec.element_type === "string" && rec.element_type.trim()
      ? rec.element_type.trim()
      : "unknown";
  const out: ReferenceElementBrief = { index, element_type };
  if (!styleOnly && typeof rec.element_id === "string" && rec.element_id.trim()) {
    out.element_id = rec.element_id.trim();
  }
  if (!styleOnly && typeof rec.name === "string" && rec.name.trim()) {
    out.name = rec.name.trim();
  }
  const position = readBox(rec, "position");
  if (position && ("x" in position || "y" in position)) {
    out.position = { x: position.x ?? 0, y: position.y ?? 0 };
  }
  const size = readBox(rec, "size");
  if (size && ("width" in size || "height" in size)) {
    out.size = { width: size.width ?? 0, height: size.height ?? 0 };
  }
  const style = asRecord(rec.style);
  if (style && typeof style.z_index === "number") {
    out.z_index = style.z_index;
  }
  const textPreview = styleOnly ? undefined : readTextPreview(rec.text);
  if (textPreview) out.text_preview = textPreview;
  if (typeof rec.background_color === "string" && rec.background_color.trim()) {
    out.background_color = rec.background_color.trim();
  }
  if (typeof rec.color === "string" && rec.color.trim()) {
    out.color = rec.color.trim();
  }
  if (typeof rec.font_size === "number") out.font_size = rec.font_size;
  if (typeof rec.font_weight === "string" || typeof rec.font_weight === "number") {
    out.font_weight = rec.font_weight;
  }
  if (typeof rec.background_image_url === "string" && rec.background_image_url.trim()) {
    out.has_background_image = true;
  }
  if (element_type === "html" || element_type === "rich") {
    out.html_note = styleOnly
      ? "layout-heavy html/rich block"
      : "layout-heavy; open full scene slide for copy if needed";
  }
  return out;
}

function collectStyleSignals(slides: ReferenceSlideBrief[]): ReferenceSceneBrief["style_signals"] {
  const colors = new Set<string>();
  const backgroundColors = new Set<string>();
  const fontSizes = new Set<number>();
  const elementTypes: Record<string, number> = {};

  for (const slide of slides) {
    if (slide.background_color) backgroundColors.add(slide.background_color);
    for (const child of slide.children) {
      elementTypes[child.element_type] = (elementTypes[child.element_type] ?? 0) + 1;
      if (child.color) colors.add(child.color);
      if (child.background_color) backgroundColors.add(child.background_color);
      if (typeof child.font_size === "number") fontSizes.add(child.font_size);
    }
  }

  return {
    colors: [...colors].sort(),
    background_colors: [...backgroundColors].sort(),
    font_sizes: [...fontSizes].sort((a, b) => a - b),
    element_types: elementTypes,
  };
}

export function buildReferenceSceneBrief(
  content: Record<string, unknown>,
  options?: BuildReferenceSceneBriefOptions,
): ReferenceSceneBrief {
  const maxChildren = options?.maxChildrenPerSlide ?? DEFAULT_MAX_CHILDREN_PER_SLIDE;
  const styleOnly = options?.styleOnly === true;
  const slides = Array.isArray(content.slide_elements) ? content.slide_elements : [];
  const briefSlides: ReferenceSlideBrief[] = [];

  for (let i = 0; i < slides.length; i++) {
    const slideRec = asRecord(slides[i]);
    if (!slideRec) continue;
    const name = styleOnly
      ? `slide ${i + 1}`
      : typeof slideRec.name === "string" && slideRec.name.trim()
        ? slideRec.name.trim()
        : `slide ${i}`;
    const childrenRaw = Array.isArray(slideRec.children_elements)
      ? slideRec.children_elements
      : [];
    const truncated = childrenRaw.length > maxChildren;
    const childrenSlice = truncated ? childrenRaw.slice(0, maxChildren) : childrenRaw;
    const children: ReferenceElementBrief[] = [];
    for (let ci = 0; ci < childrenSlice.length; ci++) {
      const childBrief = summarizeChildElement(childrenSlice[ci], ci, { styleOnly });
      if (childBrief) children.push(childBrief);
    }
    const slideBrief: ReferenceSlideBrief = {
      index: i,
      name,
      children_count: childrenRaw.length,
      children,
      ...(truncated ? { children_truncated: true } : {}),
    };
    if (!styleOnly && typeof slideRec.element_id === "string" && slideRec.element_id.trim()) {
      slideBrief.element_id = slideRec.element_id.trim();
    }
    if (typeof slideRec.background_color === "string" && slideRec.background_color.trim()) {
      slideBrief.background_color = slideRec.background_color.trim();
    }
    if (
      typeof slideRec.background_image_url === "string" &&
      slideRec.background_image_url.trim()
    ) {
      slideBrief.has_background_image = true;
    }
    const timeline = asRecord(slideRec.timeline);
    if (
      timeline &&
      typeof timeline.start_at === "number" &&
      typeof timeline.end_at === "number"
    ) {
      slideBrief.timeline = { start_at: timeline.start_at, end_at: timeline.end_at };
    }
    briefSlides.push(slideBrief);
  }

  const brief: ReferenceSceneBrief = {
    ...(styleOnly
      ? {}
      : typeof content.scene_id === "string" && content.scene_id.trim()
        ? { scene_id: content.scene_id.trim() }
        : {}),
    ...(styleOnly
      ? {}
      : typeof content.name === "string" && content.name.trim()
        ? { name: content.name.trim() }
        : {}),
    slide_count: briefSlides.length,
    slides: briefSlides,
  };
  if (styleOnly) {
    brief.style_signals = collectStyleSignals(briefSlides);
  }
  return brief;
}

export function referenceBriefPathFromScenePath(scenePath: string): string {
  return scenePath.replace(/\.scene\.json$/i, ".brief.json");
}
