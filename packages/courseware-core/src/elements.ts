// SPDX-License-Identifier: AGPL-3.0-only
import type { Properties } from "csstype";

/** React's CSSProperties is csstype's Properties<string | number>; the engine stays React-free. */
type CSSProperties = Properties<string | number>;
import * as yup from "yup";
import { EFFECT_VALUES, Effects, type Effect } from "./enums/effects.ts";
import { ELEMENT_EVENT_VALUES, type ElementEvent } from "./enums/events.ts";
import { stripUndefinedDeep } from "./strip-undefined.ts";
import { buildDefaultRichAst, parseRichAstFromJson, type RichAstNode } from "./rich-ast.ts";
import type { SlideFlowPausePoint } from "./slide-flow-pause.ts";

export type { SlideFlowPausePoint } from "./slide-flow-pause.ts";

export type ElementType =
  | "audio"
  | "button"
  | "slide"
  | "arrow"
  | "ellipse"
  | "group"
  | "html"
  | "image"
  | "input"
  | "line"
  | "narration"
  | "ppt"
  | "quiz"
  | "quiz_score_summary"
  | "rectangle"
  | "rich"
  | "svg"
  | "text"
  | "textarea"
  | "video"
  | "vtuber";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [k: string]: JsonValue };

const randomId = (): string => {
  const nativeCrypto = globalThis.crypto;
  if (nativeCrypto && typeof nativeCrypto.randomUUID === "function") {
    return nativeCrypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
};

const newElementId = (): string => `el_${randomId().slice(0, 12)}`;
const newBindingId = (): string => `eb_${randomId().slice(0, 12)}`;
const MIN_HIGHLIGHT_DURATION_MS = 500;

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Timeline {
  start_at: number;
  end_at: number;
}

export interface ElementStyle {
  opacity: number;
  rotation_deg: number;
  z_index: number;
}

export interface AnimationSegment {
  effect: Effect;
  start_at: number;
  end_at: number;
  easing: string;
}

export interface Keyframe {
  at: number;
  position: Position;
  size: Size;
  rotation_deg: number;
  opacity: number;
  easing: string;
  /**
   * {@link PPTElement} only: a **0-based** index into the page list expanded by {@link expandPptSlideRanges}.
   * An unset keyframe leaves the current page unchanged (inherits the previous moment); together with `metadata.ppt_editor_slide_index` it decides the current page on the timeline.
   */
  ppt_slide_index?: number;
}

export interface ElementHighlight {
  highlight_id: string;
  start_at: number;
  end_at: number;
  padding_px: number;
  border_radius_px: number;
  overlay_color: string;
  overlay_opacity: number;
}

export interface ElementTransform {
  position: Position;
  size: Size;
  rotation_deg: number;
  opacity: number;
}

export interface ElementEventBinding {
  binding_id: string;
  event: ElementEvent;
  action_id: string;
  script: string | null;
  external_function: string | null;
  enabled: boolean;
  once: boolean;
  capture: boolean;
  xpath: string | null;
  metadata: Record<string, JsonValue>;
}

export interface BaseElement {
  element_type: ElementType;
  element_id: string;
  name: string;
  /** Editor/runtime lock flag. Locked elements render normally but are ignored by editor hit-testing. */
  locked?: boolean;
  /**
   * Editor round-trip only (e.g. rich text on `text`). Serialized as `""` when unused.
   * Agents must **not** author embedded pages/widgets here — use {@link HtmlElement} `src`
   * (`element insert --type html --asset …` or `data:text/html;…`). `slide` / `group` omit this field.
   */
  html: string;
  fps: number;
  position: Position;
  size: Size;
  timeline: Timeline;
  style: ElementStyle;
  enter_effect: Effect;
  exit_effect: Effect;
  animations: AnimationSegment[];
  keyframes: Keyframe[];
  highlight_segments?: ElementHighlight[];
  event_bindings: ElementEventBinding[];
  action_mappings: Record<string, string>;
  event_scripts: Record<string, string>;
  preset_script: string;
  metadata: Record<string, JsonValue>;
}

/** slide / group: no `html`; for embedded pages use a child element with `element_type: "html"`. */
export type ContainerElementBase = Omit<BaseElement, "html">;

export interface ElementScriptRuntime {
  scene: Record<string, unknown>;
  browser: {
    openUrl: (url: string, target?: "_blank" | "_self") => void;
  };
  external: Record<string, (...args: unknown[]) => unknown>;
}

export interface ElementScriptPayload {
  element: Element;
  binding: ElementEventBinding;
  event?: Event;
  data?: Record<string, unknown>;
}

export interface AudioElement extends BaseElement {
  element_type: "audio";
  source: string;
  loop: boolean;
  volume: number;
  /**
   * Fade-in duration (ms). Rises linearly to volume from timeline.start_at. Default 300.
   */
  fade_in_ms: number;
  /**
   * Fade-out duration (ms). Falls linearly to 0 before timeline.end_at. Default 300.
   */
  fade_out_ms: number;
  /**
   * Trim start inside the audio source (ms). 0 plays from the beginning of the audio.
   */
  source_start_at: number;
  /**
   * Trim end inside the audio source (ms). null plays to the end of the audio.
   */
  source_end_at: number | null;
}

export interface ButtonElement extends BaseElement {
  element_type: "button";
  label: string;
  button_type: "button" | "submit" | "reset";
  disabled: boolean;
}

export interface GroupElement extends ContainerElementBase {
  element_type: "group";
  children_elements: Element[];
}

/** Scaling / tiling of the canvas background image (maps to CSS background-*). */
export const SLIDE_BACKGROUND_IMAGE_FIT_VALUES = [
  "cover",
  "contain",
  "stretch",
  "repeat",
  "repeat_x",
  "repeat_y",
  "center",
] as const;

export type SlideBackgroundImageFit = (typeof SLIDE_BACKGROUND_IMAGE_FIT_VALUES)[number];


export interface SlideElement extends ContainerElementBase {
  element_type: "slide";
  background_color: string;
  /** Flow pause point (preview/canvas playback stops on reaching it until the user continues). */
  flow_pause_points?: SlideFlowPausePoint[];
  /**
   * Canvas background image URL. Empty string / unset means no background image (combined with `background_color`: color below, image above).
   * Like image/video elements, a courseware resource URL that can be stored and signed.
   */
  background_image_url?: string;
  /** Background image fill mode. Defaults to `cover`. */
  background_image_fit?: SlideBackgroundImageFit;
  /**
   * Background HTML source (data:text/html or an http(s) URL). Empty / unset means no HTML background.
   * Rendered as a full-page HTML layer below the elements (color < image < HTML < elements).
   */
  background_html_src?: string;
  /** Content zoom of the background HTML (same meaning as the HTML element's `content_zoom`, 1–2.5). Carried over from the original element when set as background. */
  background_html_content_zoom?: number;
  children_elements: Element[];
}

/** Fill mode of image elements (maps to CSS `object-fit`). */
export const IMAGE_OBJECT_FIT_VALUES = ["contain", "cover", "fill"] as const;

export type ImageObjectFit = (typeof IMAGE_OBJECT_FIT_VALUES)[number];

export interface ImageElement extends BaseElement {
  element_type: "image";
  source: string;
  /**
   * @deprecated Merged into `object_fit`. Kept for compatibility (same as `object_fit !== "fill"`).
   */
  preserve_aspect_ratio: boolean;
  /**
   * Image fill mode. `contain` = show all / `cover` = crop to fill / `fill` = stretch.
   * Old data (without `object_fit`) migrates from `preserve_aspect_ratio`.
   */
  object_fit: ImageObjectFit;
  /**
   * Natural pixel dimensions of `source` when known (browser decode). Null until measured or if unavailable.
   * Stored for aspect ratio and layout across load/preview/runtime.
   */
  source_intrinsic_width: number | null;
  source_intrinsic_height: number | null;
}

export interface InputElement extends BaseElement {
  element_type: "input";
  value: string;
  placeholder: string;
  input_type: string;
  disabled: boolean;
  readonly: boolean;
}

export interface HtmlElement extends BaseElement {
  element_type: "html";
  src: string;
  /** Scale of embedded page content inside the element box (1 = default). */
  content_zoom?: number;
  html_event_bindings: Record<string, ElementEventBinding[]>;
  children_elements: Element[];
}

export interface SvgElement extends BaseElement {
  element_type: "svg";
  source: string;
  preserve_aspect_ratio: boolean;
}

/**
 * Rich component element: an inline, Tailwind-enabled, nestable HTML subtree on
 * the slide canvas. The UI tree lives in {@link react_layout} (a validated,
 * style-sanitized {@link RichAstNode}); the frontend renders it recursively
 * inside this element's `position` / `size` box. Unlike `html`, it is **not** an
 * iframe — it renders into the host DOM, so Tailwind `className` and real
 * container nesting (flex/grid, auto height, no overflow) work, and it
 * participates in `timeline` / `keyframes` / `enter_effect` / `highlight_segments`
 * like any other element.
 */
export interface RichElement extends BaseElement {
  element_type: "rich";
  react_layout: RichAstNode;
}

/** Filled/stroked rectangle on the slide canvas. */
export interface RectangleElement extends BaseElement {
  element_type: "rectangle";
  /** Fill color; use "transparent" for no fill. */
  color: string;
  /** Stroke color; use "transparent" for no stroke. */
  stroke_color: string;
  stroke_width: number;
  /** Corner radius in logical px (before stage scale). */
  border_radius_px: number;
}

export interface EllipseElement extends BaseElement {
  element_type: "ellipse";
  color: string;
  stroke_color: string;
  stroke_width: number;
}

/** Horizontal line spanning the element width (centered vertically). */
export interface LineElement extends BaseElement {
  element_type: "line";
  /** Stroke color. */
  color: string;
  stroke_width: number;
}

/** Horizontal arrow spanning the element width (centered vertically). */
export interface ArrowElement extends BaseElement {
  element_type: "arrow";
  /** Stroke color. */
  color: string;
  stroke_width: number;
}

export type ShapeElement = RectangleElement | EllipseElement | LineElement | ArrowElement;

export interface TextElement extends BaseElement {
  element_type: "text";
  text: string;
  font_family: string;
  font_size: number;
  color: string;
  align: string;
  /** Bold. Omitted equals false. */
  bold?: boolean;
  /** Italic. Omitted equals false. */
  italic?: boolean;
  /**
   * Background (highlight) color of the text (foreground). Note: unlike metadata.background_color,
   * which is the background color of the whole text element container (card); for geometric shapes use rectangle / ellipse / line,
   * while text_background_color applies only to the text itself (highlight inside the text paragraph).
   * Empty / undefined / "transparent" means no color.
   */
  text_background_color?: string;
  /**
   * Unitless line-height multiplier (CSS semantics: 1.2 ≈ 120% of `font_size` per line).
   * Omitted equals {@link DEFAULT_TEXT_LINE_HEIGHT}.
   */
  line_height?: number;
}

/** Default unitless line-height when `line_height` is omitted (matches legacy player/editor). */
export const DEFAULT_TEXT_LINE_HEIGHT = 1.2;

/** Resolve unitless line-height multiplier; clamps to [0.5, 5]. */
/** Schema / serialization fallback for a text element's `font_family` (same as the yup default). */
export const DEFAULT_TEXT_FONT_FAMILY_NAME = "Inter";

/** Normalize a missing, blank or invalid `font_family` into a serializable non-empty string. */
export const coerceTextFontFamily = (value: unknown): string => {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return DEFAULT_TEXT_FONT_FAMILY_NAME;
};

/**
 * Resolve an image's `object_fit`. An explicit value wins; old data (no value)
 * migrates from `preserve_aspect_ratio` (`false` → `fill` / anything else → `contain`).
 */
export const deriveImageObjectFit = (
  source: Pick<ImageElement, "object_fit" | "preserve_aspect_ratio"> | Record<string, unknown>,
): ImageObjectFit => {
  const raw = (source as Record<string, unknown>).object_fit;
  if (raw === "contain" || raw === "cover" || raw === "fill") return raw;
  if ((source as Record<string, unknown>).preserve_aspect_ratio === false) return "fill";
  return "contain";
};

export const resolveTextLineHeight = (lineHeight: number | undefined | null): number => {
  const n = lineHeight ?? DEFAULT_TEXT_LINE_HEIGHT;
  if (!Number.isFinite(n)) return DEFAULT_TEXT_LINE_HEIGHT;
  return Math.min(5, Math.max(0.5, n));
};

/** Text element container background color: `metadata.background_color` first, with the legacy `text_background_color` as fallback. */
export const resolveTextElementContainerBackground = (
  element: Pick<TextElement, "metadata" | "text_background_color">,
): string | undefined => {
  const metaBg = (element.metadata as Record<string, unknown> | undefined)?.background_color;
  if (typeof metaBg === "string" && metaBg.length > 0 && metaBg !== "transparent") {
    return metaBg;
  }
  if (element.text_background_color && element.text_background_color !== "transparent") {
    return element.text_background_color;
  }
  return undefined;
};

export const readTextElementBackgroundColorPickerValue = (
  element: Pick<TextElement, "metadata" | "text_background_color">,
): string => resolveTextElementContainerBackground(element) ?? "transparent";

export const applyTextElementBackgroundColor = (
  element: TextElement,
  color: string,
): TextElement => {
  const nextMetadata = { ...element.metadata };
  if (color === "transparent") {
    delete nextMetadata.background_color;
  } else {
    nextMetadata.background_color = color;
  }
  return {
    ...element,
    metadata: nextMetadata,
    text_background_color: undefined,
  };
};

export const buildTextElementContainerLayoutStyle = (
  element: Pick<TextElement, "metadata" | "text_background_color" | "align">,
  scale: number,
): CSSProperties => {
  const bg = resolveTextElementContainerBackground(element);
  const radius = (element.metadata as Record<string, unknown> | undefined)?.border_radius_px;
  return {
    borderRadius: typeof radius === "number" ? radius * scale : undefined,
    padding: bg ? `${8 * scale}px ${16 * scale}px` : undefined,
    justifyContent:
      element.align === "center" ? "center" : element.align === "right" ? "flex-end" : "flex-start",
  };
};

export const buildTextElementContainerStyle = (
  element: Pick<TextElement, "metadata" | "text_background_color" | "align">,
  scale: number,
): CSSProperties => ({
  ...buildTextElementContainerLayoutStyle(element, scale),
  backgroundColor: resolveTextElementContainerBackground(element),
});

export interface TextareaElement extends BaseElement {
  element_type: "textarea";
  value: string;
  placeholder: string;
  rows: number | null;
  cols: number | null;
  disabled: boolean;
  readonly: boolean;
}

export interface VideoElement extends BaseElement {
  element_type: "video";
  source: string;
  muted: boolean;
  loop: boolean;
  volume: number;
}

export interface AITeacherSpeechFields {
  ai_teacher_tts_id?: string;
  ai_teacher_tts_style?: string;
  ai_teacher_tts_speed?: number;
  ai_teacher_tts_volume?: number;
  ai_teacher_tts_pitch?: number;
  ai_teacher_language?: string;
}

export interface VtuberElement extends BaseElement, AITeacherSpeechFields {
  element_type: "vtuber";
  model_id: string;
  expression: string;
  motion: string;
}

/**
 * Quiz element: a draggable, resizable "question box" on the slide canvas.
 *
 * A peer of image/text etc., taking part in timeline / keyframes / enter_exit_effect. The whole question's
 * UI tree (stem, options, input controls, submit button, explanation) comes from the `react_layout` in `scene.quiz.questions[]`
 * matching `quiz_question_id`; the frontend renders that AST recursively inside this
 * element's `position/size`. The element itself carries no question data — it is just the "window" of one
 * question on the canvas.
 */
export interface QuizSlideElement extends BaseElement {
  element_type: "quiz";
  /** Links to `scene.quiz.questions[].question_id`; the default ("") means not yet bound. */
  quiz_question_id: string;
}

/**
 * Score summary element: a draggable, resizable summary panel window on the slide canvas.
 * Its UI tree comes from `scene.quiz.score_summary.react_layout`.
 */
export interface QuizScoreSummarySlideElement extends BaseElement {
  element_type: "quiz_score_summary";
}

export interface NarrationSegment {
  text: string;
  audio_url: string;
  duration_ms: number;
  gap_ms: number;
  /** Speech rate this segment was synthesized at; defaults to the narration element's ai_teacher_tts_speed. */
  speech_rate?: number;
  /** Audio source: TTS synthesis or microphone recording. */
  source?: "tts" | "recording";
}

export interface NarrationElement extends BaseElement, AITeacherSpeechFields {
  element_type: "narration";
  ai_teacher_id: string;
  ai_teacher_name: string;
  vtuber_element_id: string;
  script: string;
  transcript: string;
  segments: NarrationSegment[];
  subtitle_background_color: string;
  subtitle_text_color?: string;
  subtitle_background_opacity: number;
  subtitle_background_transparent: boolean;
  /** Whether to show narration subtitles on the canvas; treated as true when omitted. */
  subtitle_visible: boolean;
}

/**
 * Page range entry of an embedded PPT container element (both ends inclusive).
 * A single page is `{ start: n, end: n }`; consecutive pages are a `{ start, end }` range.
 */
export interface PPTSlideRange {
  start: number;
  end: number;
}

/**
 * Embedded PPT container: an iframe hosting the HTML pages produced by the pdf2html / pptx2html services.
 *
 * - `src` is the artifact base URL (no trailing slash), such as
 *   `https://courseware.example.com/artifact/pdf/<id>`;
 *   appending `/html/slide_<n>.html` gives the full URL of each page's HTML.
 * - `slide_count` is the total number of pages the artifact actually produced.
 * - `slide_ranges` are the page ranges this element plays; empty renders every page (1..slide_count).
 */
export interface PPTElement extends BaseElement {
  element_type: "ppt";
  src: string;
  slide_count: number;
  slide_ranges: PPTSlideRange[];
  /**
   * Transient presign cache (page number → presigned GET). On the private bucket slide HTML can only be read through
   * presigned URLs, backfilled by the presign pass at scene load (tryPresignSceneAssetUrls);
   * **never persisted** (stripAssetUrlsForPersistence strips it); when missing or expired it falls back to
   * buildPptSlideHtmlUrl. Same field name as in the student app's elements.ts (the canonical runtime).
   */
  signed_slide_urls?: Record<string, string> | null;
}

export type Element =
  | AudioElement
  | ButtonElement
  | SlideElement
  | GroupElement
  | HtmlElement
  | ImageElement
  | InputElement
  | NarrationElement
  | PPTElement
  | QuizSlideElement
  | QuizScoreSummarySlideElement
  | RectangleElement
  | EllipseElement
  | LineElement
  | ArrowElement
  | RichElement
  | SvgElement
  | TextElement
  | TextareaElement
  | VideoElement
  | VtuberElement;

export interface ParseIssue {
  path: string;
  message: string;
  nodeType?: string;
  node?: unknown;
}

export interface DeserializeOptions {
  skipInvalidNodes?: boolean;
  onIssue?: (issue: ParseIssue) => void;
}

export interface DeserializeResult<T> {
  value: T;
  issues: ParseIssue[];
}

const recordSchema = yup.object().required().default({}).unknown(true);

const positionSchema: yup.ObjectSchema<Position> = yup
  .object({
    x: yup.number().required().default(0),
    y: yup.number().required().default(0),
  })
  .required();

const sizeSchema: yup.ObjectSchema<Size> = yup
  .object({
    width: yup.number().required().min(0).default(0),
    height: yup.number().required().min(0).default(0),
  })
  .required();

const timelineSchema: yup.ObjectSchema<Timeline> = yup
  .object({
    start_at: yup.number().required().min(0).default(0),
    end_at: yup
      .number()
      .required()
      .default(0)
      .test("end_at", "timeline end_at must be >= start_at", function validate(value) {
        const start = this.parent.start_at as number;
        return typeof value === "number" && value >= start;
      }),
  })
  .required();

const styleSchema: yup.ObjectSchema<ElementStyle> = yup
  .object({
    opacity: yup.number().required().min(0).max(1).default(1),
    rotation_deg: yup.number().required().default(0),
    z_index: yup.number().required().integer().default(0),
  })
  .required();

const keyframeSchema: yup.ObjectSchema<Keyframe> = yup
  .object({
    at: yup.number().required().min(0).default(0),
    position: positionSchema.required().default(() => ({ x: 0, y: 0 })),
    size: sizeSchema.required().default(() => ({ width: 0, height: 0 })),
    rotation_deg: yup.number().required().default(0),
    opacity: yup.number().required().min(0).max(1).default(1),
    easing: yup.string().required().default("linear"),
    ppt_slide_index: yup.number().integer().min(0).optional(),
  })
  .required();

const highlightSchema: yup.ObjectSchema<ElementHighlight> = yup
  .object({
    highlight_id: yup.string().required().default(newElementId),
    start_at: yup.number().required().min(0).default(0),
    end_at: yup
      .number()
      .required()
      .default(0)
      .test("end_at", "highlight end_at must be >= start_at", function validate(value) {
        const start = this.parent.start_at as number;
        return typeof value === "number" && value >= start;
      }),
    padding_px: yup.number().required().min(0).default(0),
    border_radius_px: yup.number().required().min(0).default(24),
    overlay_color: yup.string().required().default("#000000"),
    overlay_opacity: yup.number().required().min(0).max(1).default(0.62),
  })
  .required();

const animationSchema: yup.ObjectSchema<AnimationSegment> = yup
  .object({
    effect: yup
      .mixed<Effect>()
      .oneOf(EFFECT_VALUES)
      .required()
      .default(Effects.NONE),
    start_at: yup.number().required().min(0).default(0),
    end_at: yup
      .number()
      .required()
      .default(0)
      .test("end_at", "animation end_at must be >= start_at", function validate(value) {
        const start = this.parent.start_at as number;
        return typeof value === "number" && value >= start;
      }),
    easing: yup.string().required().default("linear"),
  })
  .required();

const eventBindingSchema: yup.ObjectSchema<ElementEventBinding> = yup
  .object({
    binding_id: yup.string().required().default(newBindingId),
    event: yup.mixed<ElementEvent>().oneOf(ELEMENT_EVENT_VALUES).required(),
    action_id: yup.string().required().min(1),
    script: yup.string().nullable().default(null),
    external_function: yup.string().nullable().default(null),
    enabled: yup.boolean().required().default(true),
    once: yup.boolean().required().default(false),
    capture: yup.boolean().required().default(false),
    xpath: yup.string().nullable().default(null),
    metadata: recordSchema.default({}),
  })
  .required();

const baseSchema = yup
  .object({
    element_type: yup.string<ElementType>().required(),
    element_id: yup.string().required().default(newElementId),
    name: yup.string().defined().default(""),
    locked: yup.boolean().optional(),
    html: yup.string().defined().default(""),
    fps: yup.number().required().moreThan(0).default(30),
    position: positionSchema.required().default(() => ({ x: 0, y: 0 })),
    size: sizeSchema.required().default(() => ({ width: 0, height: 0 })),
    timeline: timelineSchema.required().default(() => ({ start_at: 0, end_at: 0 })),
    style: styleSchema
      .required()
      .default(() => ({ opacity: 1, rotation_deg: 0, z_index: 0 })),
    enter_effect: yup.mixed<Effect>().oneOf(EFFECT_VALUES).required().default(Effects.NONE),
    exit_effect: yup.mixed<Effect>().oneOf(EFFECT_VALUES).required().default(Effects.NONE),
    animations: yup.array(animationSchema).required().default([]),
    keyframes: yup.array(keyframeSchema).required().default([]),
    highlight_segments: yup.array(highlightSchema).optional(),
    event_bindings: yup.array(eventBindingSchema).required().default([]),
    action_mappings: recordSchema.default({}),
    event_scripts: recordSchema.default({}),
    preset_script: yup.string().defined().default(""),
    metadata: recordSchema.default({}),
  })
  .required()
  .unknown(false)
  .test(
    "animation-range",
    "animation range must be inside element timeline",
    (value): boolean =>
      !!value &&
      value.animations.every(
        (animation) =>
          animation.start_at >= value.timeline.start_at &&
          animation.end_at <= value.timeline.end_at,
      ),
  )
  .test(
    "keyframe-range",
    "keyframe time must be inside element timeline",
    (value): boolean =>
      !!value &&
      value.keyframes.every(
        (keyframe) =>
          keyframe.at >= value.timeline.start_at &&
          keyframe.at <= value.timeline.end_at,
      ),
  )
  .test(
    "highlight-range",
    "highlight range must be inside element timeline",
    (value): boolean =>
      !!value &&
      (value.highlight_segments ?? []).every(
        (highlight) =>
          highlight.start_at >= value.timeline.start_at &&
          highlight.end_at <= value.timeline.end_at,
      ),
  )
  .test(
    "highlight-duration",
    "highlight duration must be at least 500ms",
    (value): boolean =>
      !!value &&
      (value.highlight_segments ?? []).every(
        (highlight) => highlight.end_at - highlight.start_at >= MIN_HIGHLIGHT_DURATION_MS,
      ),
  );

const baseSchemaWithUnknown = baseSchema.clone().unknown(true);

const containerBaseSchema = baseSchema.omit(["html"]);
const containerBaseSchemaWithUnknown = containerBaseSchema.clone().unknown(true);

const isSupportedPptSrc = (value: string): boolean => {
  const src = value.trim();
  if (!src) return false;
  try {
    const url = new URL(src);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

/** Shared by serialize / deserialize: placeholder UUID when narration.ai_teacher_id is missing. */
export const UNLINKED_NARRATION_TEACHER_PLACEHOLDER_ID =
  "00000000-0000-4000-8000-000000000001";

export const resolveNarrationAiTeacherIdFromRecord = (
  record: Record<string, unknown>,
): string => {
  const top = record.ai_teacher_id;
  if (typeof top === "string" && top.trim()) return top.trim();
  const metadata = record.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const fromMeta = (metadata as Record<string, unknown>).ai_teacher_id;
    if (typeof fromMeta === "string" && fromMeta.trim()) return fromMeta.trim();
  }
  return UNLINKED_NARRATION_TEACHER_PLACEHOLDER_ID;
};

/**
 * Before narration validation: fill an empty string with the placeholder UUID so serialize does not fail.
 * Filling from metadata is done by {@link deserializeElement} / {@link normalizeElementForSerialization},
 * which set `ai_teacher_id` before validation, so only an empty-value check is needed here.
 */
const narrationAiTeacherIdSchema = yup
  .string()
  .transform((value: unknown) =>
    typeof value === "string" && value.trim()
      ? value.trim()
      : UNLINKED_NARRATION_TEACHER_PLACEHOLDER_ID,
  )
  .required()
  .min(1);

const pptSlideRangeSchema: yup.ObjectSchema<PPTSlideRange> = yup
  .object({
    start: yup.number().required().integer().min(1).default(1),
    end: yup
      .number()
      .required()
      .integer()
      .min(1)
      .default(1)
      .test("ppt-range-end", "slide_ranges.end must be >= start", function validate(value) {
        const start = this.parent.start as number;
        return typeof value === "number" && value >= start;
      }),
  })
  .required();

const scalarSchemas = {
  audio: baseSchema.shape({
    element_type: yup.mixed<"audio">().oneOf(["audio"]).required(),
    source: yup.string().required().min(1),
    loop: yup.boolean().required().default(false),
    volume: yup.number().required().min(0).max(1).default(1),
    fade_in_ms: yup.number().required().min(0).default(300),
    fade_out_ms: yup.number().required().min(0).default(300),
    source_start_at: yup.number().required().min(0).default(0),
    source_end_at: yup.number().nullable().optional().min(0).default(null),
  }),
  button: baseSchema.shape({
    element_type: yup.mixed<"button">().oneOf(["button"]).required(),
    label: yup.string().defined().default(""),
    button_type: yup
      .mixed<"button" | "submit" | "reset">()
      .oneOf(["button", "submit", "reset"])
      .required()
      .default("button"),
    disabled: yup.boolean().required().default(false),
  }),
  image: baseSchema.shape({
    element_type: yup.mixed<"image">().oneOf(["image"]).required(),
    source: yup.string().required().min(1),
    preserve_aspect_ratio: yup.boolean().required().default(true),
    object_fit: yup
      .mixed<ImageObjectFit>()
      .transform((value) =>
        IMAGE_OBJECT_FIT_VALUES.includes(value as ImageObjectFit) ? value : undefined,
      )
      .oneOf([...IMAGE_OBJECT_FIT_VALUES])
      .required()
      .default("contain"),
    source_intrinsic_width: yup.number().nullable().optional().default(null),
    source_intrinsic_height: yup.number().nullable().optional().default(null),
  }),
  input: baseSchema.shape({
    element_type: yup.mixed<"input">().oneOf(["input"]).required(),
    value: yup.string().defined().default(""),
    placeholder: yup.string().defined().default(""),
    input_type: yup.string().required().default("text"),
    disabled: yup.boolean().required().default(false),
    readonly: yup.boolean().required().default(false),
  }),
  svg: baseSchema.shape({
    element_type: yup.mixed<"svg">().oneOf(["svg"]).required(),
    source: yup.string().required().min(1),
    preserve_aspect_ratio: yup.boolean().required().default(true),
  }),
  rectangle: baseSchema.shape({
    element_type: yup.mixed<"rectangle">().oneOf(["rectangle"]).required(),
    color: yup.string().required().default("#3B82F6"),
    stroke_color: yup.string().defined().default("transparent"),
    stroke_width: yup.number().required().min(0).default(0),
    border_radius_px: yup.number().required().min(0).default(0),
  }),
  ellipse: baseSchema.shape({
    element_type: yup.mixed<"ellipse">().oneOf(["ellipse"]).required(),
    color: yup.string().required().default("#3B82F6"),
    stroke_color: yup.string().defined().default("transparent"),
    stroke_width: yup.number().required().min(0).default(0),
  }),
  line: baseSchema.shape({
    element_type: yup.mixed<"line">().oneOf(["line"]).required(),
    color: yup.string().required().default("#94A3B8"),
    stroke_width: yup.number().required().min(0).default(2),
  }),
  arrow: baseSchema.shape({
    element_type: yup.mixed<"arrow">().oneOf(["arrow"]).required(),
    color: yup.string().required().default("#94A3B8"),
    stroke_width: yup.number().required().min(0).default(2),
  }),
  text: baseSchema.shape({
    element_type: yup.mixed<"text">().oneOf(["text"]).required(),
    text: yup.string().defined().default(""),
    font_family: yup.string().required().default("Inter"),
    font_size: yup.number().required().integer().moreThan(0).default(36),
    color: yup.string().required().default("#FFFFFF"),
    align: yup.string().required().default("left"),
    bold: yup.boolean().optional(),
    italic: yup.boolean().optional(),
    text_background_color: yup.string().optional(),
    line_height: yup.number().min(0.5).max(5).default(DEFAULT_TEXT_LINE_HEIGHT),
  }),
  textarea: baseSchema.shape({
    element_type: yup.mixed<"textarea">().oneOf(["textarea"]).required(),
    value: yup.string().defined().default(""),
    placeholder: yup.string().defined().default(""),
    rows: yup.number().integer().moreThan(0).nullable().default(null),
    cols: yup.number().integer().moreThan(0).nullable().default(null),
    disabled: yup.boolean().required().default(false),
    readonly: yup.boolean().required().default(false),
  }),
  video: baseSchema.shape({
    element_type: yup.mixed<"video">().oneOf(["video"]).required(),
    source: yup.string().required().min(1),
    muted: yup.boolean().required().default(false),
    loop: yup.boolean().required().default(false),
    volume: yup.number().required().min(0).max(1).default(1),
  }),
  vtuber: baseSchema.shape({
    element_type: yup.mixed<"vtuber">().oneOf(["vtuber"]).required(),
    model_id: yup.string().required().min(1),
    expression: yup.string().required().default("neutral"),
    motion: yup.string().required().default("idle"),
    ai_teacher_tts_id: yup.string().optional(),
    ai_teacher_tts_style: yup.string().optional(),
    ai_teacher_tts_speed: yup.number().optional(),
    ai_teacher_tts_volume: yup.number().optional(),
    ai_teacher_tts_pitch: yup.number().optional(),
    ai_teacher_language: yup.string().optional(),
  }),
  ppt: baseSchema.shape({
    element_type: yup.mixed<"ppt">().oneOf(["ppt"]).required(),
    src: yup
      .string()
      .required()
      .test(
        "ppt-src",
        "src must be an http/https URL (e.g. https://courseware.example.com/artifact/pdf/<id>)",
        (value) => typeof value === "string" && isSupportedPptSrc(value),
      ),
    slide_count: yup.number().required().integer().min(0).default(0),
    slide_ranges: yup.array(pptSlideRangeSchema).required().default([]),
  }),
  narration: baseSchema.shape({
    element_type: yup.mixed<"narration">().oneOf(["narration"]).required(),
    ai_teacher_id: narrationAiTeacherIdSchema,
    ai_teacher_name: yup.string().defined().default(""),
    ai_teacher_tts_id: yup.string().optional(),
    ai_teacher_tts_style: yup.string().optional(),
    ai_teacher_tts_speed: yup.number().optional(),
    ai_teacher_tts_volume: yup.number().optional(),
    ai_teacher_tts_pitch: yup.number().optional(),
    ai_teacher_language: yup.string().optional(),
    vtuber_element_id: yup.string().defined().default(""),
    script: yup.string().defined().default(""),
    transcript: yup.string().defined().default(""),
    subtitle_background_color: yup.string().defined().default("#020617"),
    subtitle_text_color: yup.string().optional(),
    subtitle_background_opacity: yup.number().required().min(0).max(1).default(0.7),
    subtitle_background_transparent: yup.boolean().required().default(false),
    subtitle_visible: yup.boolean().required().default(true),
    segments: yup
      .array(
        yup
          .object({
            text: yup.string().defined().default(""),
            audio_url: yup.string().required().default(""),
            duration_ms: yup.number().required().min(0).default(0),
            gap_ms: yup.number().required().min(0).default(100),
            speech_rate: yup.number().optional().min(0.5).max(2),
            source: yup.mixed<"tts" | "recording">().oneOf(["tts", "recording"]).optional(),
          })
          .required(),
      )
      .required()
      .default([]),
  }),
} as const;

const validateSchema = <T>(schema: yup.Schema<T>, input: unknown): T =>
  schema.validateSync(input, { strict: true, abortEarly: false, stripUnknown: false });

const isSupportedHtmlSrc = (value: string): boolean => {
  const src = value.trim();
  if (!src) return false;
  if (src.toLowerCase().startsWith("data:text/html")) return true;
  try {
    const url = new URL(src);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Combine the PPT artifact base URL and a page number into the full HTML URL.
 *
 * The base looks like `https://courseware.example.com/artifact/pdf/<id>`, the result like
 * `https://courseware.example.com/artifact/pdf/<id>/html/slide_1.html`.
 */
export const buildPptSlideHtmlUrl = (src: string, slideNumber: number): string => {
  const base = src.trim().replace(/\/+$/, "");
  if (!base) return "";
  const safe = Math.max(1, Math.floor(slideNumber));
  return `${base}/html/slide_${safe}.html`;
};

/**
 * Resolve the slide HTML URL at render time: prefer the signed URL backfilled by the presign pass (OCI private bucket),
 * falling back to the unsigned CDN concatenation (Aliyun public bucket path) when missing/expired.
 */
export const resolvePptSlideHtmlUrl = (
  element: Pick<PPTElement, "src" | "signed_slide_urls">,
  slideNumber: number,
): string => {
  const safe = Math.max(1, Math.floor(slideNumber));
  const signed = element.signed_slide_urls?.[String(safe)];
  return signed || buildPptSlideHtmlUrl(element.src, safe);
};

/**
 * Expand `slide_ranges` into a deduplicated list of page numbers in order of appearance.
 * Empty `ranges` falls back to `1..slideCount`; entries beyond `slideCount` are clipped.
 */
export const expandPptSlideRanges = (
  ranges: PPTSlideRange[],
  slideCount: number,
): number[] => {
  if (!Number.isFinite(slideCount) || slideCount <= 0) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  if (!ranges || ranges.length === 0) {
    for (let i = 1; i <= slideCount; i += 1) out.push(i);
    return out;
  }
  for (const range of ranges) {
    if (!range) continue;
    const startRaw = Math.floor(range.start);
    const endRaw = Math.floor(range.end);
    if (!Number.isFinite(startRaw) || !Number.isFinite(endRaw)) continue;
    const lo = Math.max(1, Math.min(slideCount, Math.min(startRaw, endRaw)));
    const hi = Math.max(1, Math.min(slideCount, Math.max(startRaw, endRaw)));
    for (let i = lo; i <= hi; i += 1) {
      if (seen.has(i)) continue;
      seen.add(i);
      out.push(i);
    }
  }
  return out;
};

const clampPptSlideIndex = (element: PPTElement, index: number): number => {
  const slides = expandPptSlideRanges(element.slide_ranges, element.slide_count);
  const maxIdx = Math.max(0, slides.length - 1);
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(maxIdx, Math.floor(index)));
};

/**
 * Current page of a PPT element on the timeline (0-based, relative to the {@link expandPptSlideRanges} list).
 *
 * - Starts from `metadata.ppt_editor_slide_index` (when manual page turns in the editor wrote no keyframe).
 * - In keyframe time order, the `ppt_slide_index` explicitly set on the last frame with `at <= timeMs` overrides it.
 */
export const resolvePptSlideIndexForTimeline = (element: PPTElement, timeMs: number): number => {
  const meta = element.metadata as Record<string, unknown> | undefined;
  const rawMeta = meta?.ppt_editor_slide_index;
  let idx =
    typeof rawMeta === "number" && Number.isFinite(rawMeta) ? Math.floor(rawMeta) : 0;
  const sorted = [...element.keyframes].sort((a, b) => a.at - b.at);
  for (const k of sorted) {
    if (k.at > timeMs) break;
    if (typeof k.ppt_slide_index === "number" && Number.isFinite(k.ppt_slide_index)) {
      idx = Math.floor(k.ppt_slide_index);
    }
  }
  return clampPptSlideIndex(element, idx);
};

/**
 * Serialize `slide_ranges` into a human-readable string that parses back, e.g.
 * `[{1,1},{3,5}]` → `"1, 3-5"`. An empty array (= all) renders as an empty string.
 */
export const formatPptSlideRanges = (ranges: PPTSlideRange[]): string => {
  if (!ranges || ranges.length === 0) return "";
  return ranges
    .map((range) => {
      const start = Math.floor(range.start);
      const end = Math.floor(range.end);
      if (start === end) return `${start}`;
      return `${start}-${end}`;
    })
    .join(", ");
};

/**
 * Parse a human-entered page string (e.g. `"1, 3, 5-8"`) into normalized `slide_ranges`.
 * Fragments that fail to parse are dropped; an empty string means "unrestricted (all pages)" and returns an empty array.
 */
export const parsePptSlideRanges = (input: string): PPTSlideRange[] => {
  const text = input.trim();
  if (!text) return [];
  const out: PPTSlideRange[] = [];
  const tokens = text.split(/[\s,，;；]+/g).filter(Boolean);
  for (const token of tokens) {
    const rangeMatch = token.match(/^(\d+)\s*[-~–]\s*(\d+)$/);
    if (rangeMatch) {
      const a = parseInt(rangeMatch[1], 10);
      const b = parseInt(rangeMatch[2], 10);
      if (Number.isFinite(a) && Number.isFinite(b) && a >= 1 && b >= 1) {
        out.push({ start: Math.min(a, b), end: Math.max(a, b) });
      }
      continue;
    }
    const single = parseInt(token, 10);
    if (Number.isFinite(single) && single >= 1) {
      out.push({ start: single, end: single });
    }
  }
  return out;
};

const issueFromError = (error: unknown, path: string, node: unknown): ParseIssue => {
  if (!(error instanceof yup.ValidationError)) {
    return { path, message: error instanceof Error ? error.message : String(error), node };
  }
  const detail =
    error.inner.length > 0
      ? error.inner.map((item) => `${item.path ?? "(root)"}: ${item.message}`).join("; ")
      : error.message;
  return {
    path,
    message: detail,
    nodeType:
      typeof node === "object" && node !== null && "element_type" in node
        ? String((node as { element_type?: unknown }).element_type)
        : undefined,
    node,
  };
};

const pushIssue = (issues: ParseIssue[], options: DeserializeOptions, issue: ParseIssue): void => {
  issues.push(issue);
  options.onIssue?.(issue);
};

const parseChildren = (
  value: unknown,
  path: string,
  options: DeserializeOptions,
  issues: ParseIssue[],
): Element[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    const issue = { path, message: "children_elements must be an array", node: value };
    if (options.skipInvalidNodes) {
      pushIssue(issues, options, issue);
      return [];
    }
    throw new Error(`${path}: ${issue.message}`);
  }
  const out: Element[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const nodePath = `${path}[${index}]`;
    try {
      out.push(deserializeElement(value[index], { ...options, _issues: issues }, nodePath));
    } catch (error) {
      if (!options.skipInvalidNodes) throw error;
      pushIssue(issues, options, issueFromError(error, nodePath, value[index]));
    }
  }
  return out;
};

const parseHtmlBindings = (
  value: unknown,
  path: string,
  options: DeserializeOptions,
  issues: ParseIssue[],
): Record<string, ElementEventBinding[]> => {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    const issue = { path, message: "html_event_bindings must be an object", node: value };
    if (options.skipInvalidNodes) {
      pushIssue(issues, options, issue);
      return {};
    }
    throw new Error(`${path}: ${issue.message}`);
  }
  const out: Record<string, ElementEventBinding[]> = {};
  for (const [xpath, maybeBindings] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const xpathPath = `${path}.${xpath}`;
    if (!xpath.trim()) {
      const issue = { path: xpathPath, message: "xpath cannot be blank", node: maybeBindings };
      if (options.skipInvalidNodes) {
        pushIssue(issues, options, issue);
        continue;
      }
      throw new Error(`${xpathPath}: ${issue.message}`);
    }
    if (!Array.isArray(maybeBindings)) {
      const issue = {
        path: xpathPath,
        message: "bindings must be an array",
        node: maybeBindings,
      };
      if (options.skipInvalidNodes) {
        pushIssue(issues, options, issue);
        continue;
      }
      throw new Error(`${xpathPath}: ${issue.message}`);
    }
    const bindings: ElementEventBinding[] = [];
    for (let index = 0; index < maybeBindings.length; index += 1) {
      const bindingPath = `${xpathPath}[${index}]`;
      try {
        const binding = validateSchema(eventBindingSchema, maybeBindings[index]);
        bindings.push({ ...binding, xpath: binding.xpath ?? xpath });
      } catch (error) {
        if (!options.skipInvalidNodes) throw error;
        pushIssue(issues, options, issueFromError(error, bindingPath, maybeBindings[index]));
      }
    }
    out[xpath] = bindings;
  }
  return out;
};

type InternalOptions = DeserializeOptions & { _issues?: ParseIssue[] };

const runScript = (
  script: string,
  runtime: ElementScriptRuntime,
  payload: ElementScriptPayload,
): unknown => {
  const runner = new Function("runtime", "payload", `"use strict";\n${script}`);
  return runner(runtime, payload);
};

export const executeElementBinding = (
  element: Element,
  binding: ElementEventBinding,
  runtime: ElementScriptRuntime,
  payload: Omit<ElementScriptPayload, "element" | "binding"> = {},
): {
  invokedExternalFunction?: string;
  externalResult?: unknown;
  eventScriptResult?: unknown;
  bindingScriptResult?: unknown;
  presetScriptResult?: unknown;
} => {
  if (!binding.enabled) return {};

  const out: {
    invokedExternalFunction?: string;
    externalResult?: unknown;
    eventScriptResult?: unknown;
    bindingScriptResult?: unknown;
    presetScriptResult?: unknown;
  } = {};
  const resolvedPayload: ElementScriptPayload = {
    element,
    binding,
    ...payload,
  };

  const mappedExternalName = binding.external_function ?? element.action_mappings[binding.action_id];
  if (mappedExternalName) {
    const mappedExternal = runtime.external[mappedExternalName];
    if (typeof mappedExternal === "function") {
      out.invokedExternalFunction = mappedExternalName;
      out.externalResult = mappedExternal(resolvedPayload);
    }
  }

  const eventScript = element.event_scripts[binding.event];
  if (eventScript?.trim()) {
    out.eventScriptResult = runScript(eventScript, runtime, resolvedPayload);
  }
  if (binding.script?.trim()) {
    out.bindingScriptResult = runScript(binding.script, runtime, resolvedPayload);
  }
  if (element.preset_script.trim()) {
    out.presetScriptResult = runScript(element.preset_script, runtime, resolvedPayload);
  }
  return out;
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const applyEasing = (t: number, easing: string): number => {
  const clamped = Math.min(1, Math.max(0, t));
  switch (easing) {
    case "ease-in":
      return clamped * clamped;
    case "ease-out":
      return 1 - (1 - clamped) * (1 - clamped);
    case "ease-in-out":
      return clamped < 0.5
        ? 2 * clamped * clamped
        : 1 - Math.pow(-2 * clamped + 2, 2) / 2;
    case "linear":
    default:
      return clamped;
  }
};

const baseTransformOf = (element: Element): ElementTransform => ({
  position: { x: element.position.x, y: element.position.y },
  size: { width: element.size.width, height: element.size.height },
  rotation_deg: element.style.rotation_deg,
  opacity: element.style.opacity,
});

/** Slide canvas `audio` does not use keyframe animation for transform. */
const isSlideCanvasAudioNoTransformKeyframes = (element: Element): boolean =>
  element.element_type === "audio";

type SortedKeyframesCacheEntry = {
  keyframesRef: Element["keyframes"];
  sorted: Element["keyframes"];
};

const sortedKeyframesCache = new WeakMap<Element, SortedKeyframesCacheEntry>();

/** Playback hot path: avoid re-sorting `element.keyframes` every frame. */
export const getSortedElementKeyframes = (element: Element): Element["keyframes"] => {
  const raw = element.keyframes;
  const cached = sortedKeyframesCache.get(element);
  if (cached && cached.keyframesRef === raw) return cached.sorted;
  const sorted = [...raw].sort((a, b) => a.at - b.at);
  sortedKeyframesCache.set(element, { keyframesRef: raw, sorted });
  return sorted;
};

export const interpolateElementTransform = (
  element: Element,
  time: number,
): ElementTransform => {
  if (isSlideCanvasAudioNoTransformKeyframes(element)) {
    return baseTransformOf(element);
  }
  const keyframes = getSortedElementKeyframes(element);
  if (keyframes.length === 0) return baseTransformOf(element);

  const first = keyframes[0];
  if (time <= first.at) {
    return {
      position: { x: first.position.x, y: first.position.y },
      size: { width: first.size.width, height: first.size.height },
      rotation_deg: first.rotation_deg,
      opacity: first.opacity,
    };
  }
  const last = keyframes[keyframes.length - 1];
  if (time >= last.at) {
    return {
      position: { x: last.position.x, y: last.position.y },
      size: { width: last.size.width, height: last.size.height },
      rotation_deg: last.rotation_deg,
      opacity: last.opacity,
    };
  }
  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const a = keyframes[index];
    const b = keyframes[index + 1];
    if (time >= a.at && time <= b.at) {
      const span = Math.max(1, b.at - a.at);
      const raw = (time - a.at) / span;
      const t = applyEasing(raw, b.easing || "linear");
      return {
        position: {
          x: lerp(a.position.x, b.position.x, t),
          y: lerp(a.position.y, b.position.y, t),
        },
        size: {
          width: lerp(a.size.width, b.size.width, t),
          height: lerp(a.size.height, b.size.height, t),
        },
        rotation_deg: lerp(a.rotation_deg, b.rotation_deg, t),
        opacity: lerp(a.opacity, b.opacity, t),
      };
    }
  }
  return baseTransformOf(element);
};

/**
 * In the new quiz model a quiz element is a single positionable box on the
 * slide canvas (no group/member layout). `interpolateElementTransformInSlide`
 * therefore reduces to per-element keyframe interpolation; we keep the
 * function for callers that pass `slide` for symmetry with the older API.
 */
export const interpolateElementTransformInSlide = (
  element: Element,
  time: number,
  _slide: SlideElement,
): ElementTransform => interpolateElementTransform(element, time);

/**
 * Axis-aligned bounding box (stage CSS pixels) for a single quiz canvas
 * element. Used by submit-feedback bubble alignment.
 */
export const getQuizQuestionGroupBoundsSlidePx = (
  _slide: SlideElement,
  wrapper: QuizSlideElement,
  time: number,
  scale: number,
): { left: number; top: number; right: number; bottom: number; width: number; height: number } => {
  const interp = interpolateElementTransform(wrapper, time);
  const w = interp.size.width * scale;
  const h = interp.size.height * scale;
  const l = interp.position.x * scale;
  const t = interp.position.y * scale;
  return {
    left: l,
    top: t,
    right: l + w,
    bottom: t + h,
    width: w,
    height: h,
  };
};

export const isElementVisibleAtTime = (element: Element, time: number): boolean => {
  return time >= element.timeline.start_at && time <= element.timeline.end_at;
};

/**
 * Slide-aware visibility: in the new quiz model each quiz is a single element
 * with its own timeline, so this collapses to {@link isElementVisibleAtTime}.
 * The `slide` parameter is kept for API symmetry.
 */
export const isElementVisibleAtTimeInSlide = (
  element: Element,
  time: number,
  _slide: SlideElement,
): boolean => isElementVisibleAtTime(element, time);

/**
 * Along sorted keyframes, finds the end time of the first opacity **increase** segment that is
 * still relevant at {@link rangeStart}. Flat segments and fade-out (opacity decreases) are skipped
 * so a later exit fade does not delay quiz pause. Used by preview playback to avoid pausing while a
 * question block is still fading in.
 */
export const getOpacityIntroRampEndAt = (
  opacityAt: (t: number) => number,
  keyframes: Keyframe[],
  rangeStart: number,
  rangeEnd: number,
): number => {
  const kfs = [...keyframes].sort((a, b) => a.at - b.at);
  if (kfs.length <= 1) return rangeStart;

  const last = kfs[kfs.length - 1];
  if (rangeStart >= last.at) return rangeStart;

  let idx = 0;
  if (rangeStart >= kfs[0].at) {
    while (idx < kfs.length - 1 && rangeStart > kfs[idx + 1].at) idx += 1;
  }

  if (rangeStart >= kfs[kfs.length - 1].at) return rangeStart;

  for (let j = idx; j < kfs.length - 1; j += 1) {
    const a = kfs[j];
    const b = kfs[j + 1];
    if (b.at <= rangeStart) continue;
    const tEnter = Math.max(a.at, rangeStart);
    const opA = opacityAt(Math.min(tEnter, rangeEnd));
    const opB = opacityAt(Math.min(b.at, rangeEnd));
    if (opB > opA + 1e-5) {
      return Math.min(b.at, rangeEnd);
    }
  }
  return rangeStart;
};

/**
 * Preview quiz pause waits at least this long after question `timeline.start_at` when opacity is not
 * driven by keyframes (typical quiz canvas: wrapper has no keyframes; fade-in is only the preview
 * layer CSS opacity transition). Keep in sync with `PreviewElement` `transition` in `courseware-preview.tsx`.
 */
export const QUIZ_PREVIEW_ELEMENT_OPACITY_TRANSITION_MS = 180;

/** Default duration (ms) for each of {@link BaseElement.enter_effect} / {@link BaseElement.exit_effect}. */
export const ELEMENT_ENTER_EXIT_EFFECT_DEFAULT_MS = 500;

const easeOutCubic = (u: number): number => {
  const t = 1 - u;
  return 1 - t * t * t;
};

const easeInCubic = (u: number): number => u * u * u;

const ENTER_TIMELINE_EFFECTS: ReadonlySet<Effect> = new Set([
  Effects.FADE_IN,
  Effects.SCALE_IN,
  Effects.ROTATE_IN,
  Effects.TRANSLATE_IN,
]);

const EXIT_TIMELINE_EFFECTS: ReadonlySet<Effect> = new Set([
  Effects.FADE_OUT,
  Effects.SCALE_OUT,
  Effects.ROTATE_OUT,
  Effects.TRANSLATE_OUT,
]);

/**
 * Timeline segment used to schedule enter/exit effects: each element uses its
 * own timeline now (quiz is one element on the slide, not a wrapper + members).
 */
export const getElementEnterExitEffectTimelineBounds = (
  element: Element,
  _slide: SlideElement,
): { start: number; end: number } => ({
  start: element.timeline.start_at,
  end: element.timeline.end_at,
});

export const resolveEnterExitEffectDurationsMs = (
  spanMs: number,
  enterEffect: Effect,
  exitEffect: Effect,
): { enterMs: number; exitMs: number } => {
  const span = Math.max(0, spanMs);
  const useEnter = ENTER_TIMELINE_EFFECTS.has(enterEffect);
  const useExit = EXIT_TIMELINE_EFFECTS.has(exitEffect);
  if (span === 0 || (!useEnter && !useExit)) return { enterMs: 0, exitMs: 0 };
  const cap = ELEMENT_ENTER_EXIT_EFFECT_DEFAULT_MS;
  if (useEnter && useExit) {
    if (span < 2) return { enterMs: span, exitMs: 0 };
    const enterMs = Math.min(cap, Math.floor(span / 2));
    const exitMs = Math.min(cap, span - enterMs);
    return { enterMs, exitMs };
  }
  if (useEnter) return { enterMs: Math.min(cap, span), exitMs: 0 };
  return { enterMs: 0, exitMs: Math.min(cap, span) };
};

/** Absolute slide time when the element’s enter effect has finished (or `bounds.start` if none). */
export const getEnterEffectCompletionTime = (element: Element, slide: SlideElement): number => {
  const bounds = getElementEnterExitEffectTimelineBounds(element, slide);
  if (!ENTER_TIMELINE_EFFECTS.has(element.enter_effect)) return bounds.start;
  const span = Math.max(0, bounds.end - bounds.start);
  const { enterMs } = resolveEnterExitEffectDurationsMs(span, element.enter_effect, element.exit_effect);
  return Math.min(bounds.end, bounds.start + enterMs);
};

export interface ElementEnterExitEffectVisual {
  /** Multiplied with interpolated opacity after visibility gating. */
  opacityFactor: number;
  /** Logical-space translation inside the element box (multiply by layout scale at the render site). */
  translateLogicalX: number;
  translateLogicalY: number;
  /** Extra rotation (deg) applied on the inner effect layer. */
  rotateExtraDeg: number;
  /** Uniform scale around the element center on the inner layer. */
  uniformScale: number;
  /**
   * When true, preview should not apply CSS `opacity` transitions on the outer wrapper — the effect
   * already animates opacity every frame.
   */
  prefersInstantOpacity: boolean;
}

const identityEnterExitEffectVisual = (): ElementEnterExitEffectVisual => ({
  opacityFactor: 1,
  translateLogicalX: 0,
  translateLogicalY: 0,
  rotateExtraDeg: 0,
  uniformScale: 1,
  prefersInstantOpacity: false,
});

/**
 * Visual modifiers for {@link BaseElement.enter_effect} / {@link BaseElement.exit_effect} at a slide-local time.
 * Compose on top of {@link interpolateElementTransformInSlide} (position/size/rotation/opacity).
 */
export const computeElementEnterExitEffectVisual = (
  element: Element,
  slide: SlideElement,
  timeMs: number,
): ElementEnterExitEffectVisual => {
  const out = identityEnterExitEffectVisual();
  const bounds = getElementEnterExitEffectTimelineBounds(element, slide);
  const span = Math.max(0, bounds.end - bounds.start);
  if (span <= 0 || timeMs < bounds.start || timeMs > bounds.end) {
    return out;
  }
  const { enterMs, exitMs } = resolveEnterExitEffectDurationsMs(
    span,
    element.enter_effect,
    element.exit_effect,
  );
  const tRel = timeMs - bounds.start;
  const h = Math.max(1, element.size.height);
  const w = Math.max(1, element.size.width);
  const translateMag = Math.min(200, Math.max(48, Math.max(w, h) * 0.22));

  if (enterMs > 0 && tRel < enterMs && ENTER_TIMELINE_EFFECTS.has(element.enter_effect)) {
    const u = Math.min(1, Math.max(0, tRel / enterMs));
    const p = easeOutCubic(u);
    out.prefersInstantOpacity = true;
    switch (element.enter_effect) {
      case Effects.FADE_IN:
        out.opacityFactor *= p;
        break;
      case Effects.SCALE_IN:
        out.uniformScale *= Math.max(0.02, p);
        break;
      case Effects.ROTATE_IN:
        out.rotateExtraDeg = 22 * (1 - p);
        break;
      case Effects.TRANSLATE_IN:
        out.translateLogicalY = translateMag * (1 - p);
        break;
      default:
        break;
    }
  }

  if (exitMs > 0 && tRel >= span - exitMs && EXIT_TIMELINE_EFFECTS.has(element.exit_effect)) {
    const u = Math.min(1, Math.max(0, (tRel - (span - exitMs)) / exitMs));
    const p = easeInCubic(u);
    out.prefersInstantOpacity = true;
    switch (element.exit_effect) {
      case Effects.FADE_OUT:
        out.opacityFactor *= 1 - p;
        break;
      case Effects.SCALE_OUT:
        out.uniformScale *= Math.max(0.02, 1 - p);
        out.opacityFactor *= 1 - p;
        break;
      case Effects.ROTATE_OUT:
        out.rotateExtraDeg = -20 * p;
        out.opacityFactor *= 1 - p;
        break;
      case Effects.TRANSLATE_OUT:
        out.translateLogicalY = translateMag * p;
        out.opacityFactor *= 1 - p;
        break;
      default:
        break;
    }
  }

  out.opacityFactor = Math.min(1, Math.max(0, out.opacityFactor));
  return out;
};

/**
 * Earliest slide-local time at which preview-style "pause for unanswered quiz"
 * should apply: after the quiz element's intro keyframe ramp (or a CSS-style
 * fade fallback when there are no opacity keyframes), and after enter effects
 * ({@link computeElementEnterExitEffectVisual}).
 */
export const getQuizQuestionPlaybackPauseStartAt = (
  slide: SlideElement,
  wrapper: QuizSlideElement,
): number => {
  const t0 = wrapper.timeline.start_at;
  const tEnd = wrapper.timeline.end_at;

  const opacityAt = (t: number): number => {
    const base = interpolateElementTransform(wrapper, t).opacity;
    const fx = computeElementEnterExitEffectVisual(wrapper, slide, t).opacityFactor;
    return base * fx;
  };
  const introRampEnd = getOpacityIntroRampEndAt(opacityAt, wrapper.keyframes, t0, tEnd);
  const withNoKeyframeFallback = Math.max(introRampEnd, t0 + QUIZ_PREVIEW_ELEMENT_OPACITY_TRANSITION_MS);
  let out = Math.min(withNoKeyframeFallback, tEnd);
  out = Math.max(out, getEnterEffectCompletionTime(wrapper, slide));
  return Math.min(out, tEnd);
};

export const getElementHighlightSegments = (element: Element): ElementHighlight[] =>
  element.highlight_segments ?? [];

export const isElementHighlightActiveAtTime = (
  highlight: ElementHighlight,
  time: number,
): boolean => time >= highlight.start_at && time <= highlight.end_at;

const clampMs = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const KEYFRAME_TIME_COLLISION_THRESHOLD_MS = 8;

const isSameKeyframeTime = (a: number, b: number): boolean =>
  Math.abs(a - b) <= KEYFRAME_TIME_COLLISION_THRESHOLD_MS;

const normalizeKeyframesByTime = (keyframes: Keyframe[]): Keyframe[] => {
  const sorted = [...keyframes].sort((a, b) => a.at - b.at);
  return sorted.filter(
    (keyframe, index) =>
      index === 0 ||
      !sorted.slice(0, index).some((prev) => isSameKeyframeTime(prev.at, keyframe.at)),
  );
};

/** Clamp keyframes / animations / highlights to element timeline (recursive for containers). */
export const clampElementTimedRangesToTimeline = <T extends Element>(element: T): T => {
  let { start_at: startAt, end_at: endAt } = element.timeline;
  if (!Number.isFinite(startAt)) startAt = 0;
  if (!Number.isFinite(endAt)) endAt = startAt;
  if (endAt < startAt) endAt = startAt;
  const keyframes = normalizeKeyframesByTime(
    element.keyframes.map((keyframe) => ({
      ...keyframe,
      at: clampMs(keyframe.at, startAt, endAt),
    })),
  );
  const animations = element.animations
    .map((animation) => {
      const animationStart = clampMs(animation.start_at, startAt, endAt);
      return {
        ...animation,
        start_at: animationStart,
        end_at: clampMs(animation.end_at, animationStart, endAt),
      };
    })
    .filter((animation) => animation.end_at >= animation.start_at);
  const highlight_segments =
    endAt - startAt >= MIN_HIGHLIGHT_DURATION_MS
      ? element.highlight_segments
          ?.map((highlight) => {
            const highlightStart = clampMs(
              highlight.start_at,
              startAt,
              Math.max(startAt, endAt - MIN_HIGHLIGHT_DURATION_MS),
            );
            return {
              ...highlight,
              start_at: highlightStart,
              end_at: clampMs(
                highlight.end_at,
                highlightStart + MIN_HIGHLIGHT_DURATION_MS,
                endAt,
              ),
            };
          })
          .filter(
            (highlight) =>
              highlight.end_at - highlight.start_at >= MIN_HIGHLIGHT_DURATION_MS,
          )
          .sort((a, b) => a.start_at - b.start_at)
      : undefined;

  let clamped = {
    ...element,
    timeline: { start_at: startAt, end_at: endAt },
    keyframes,
    animations,
    ...(highlight_segments === undefined ? {} : { highlight_segments }),
  } as T;

  if (
    clamped.element_type === "slide" ||
    clamped.element_type === "group" ||
    clamped.element_type === "html"
  ) {
    clamped = {
      ...clamped,
      children_elements: clamped.children_elements.map((child) =>
        clampElementTimedRangesToTimeline(child),
      ),
    } as T;
  }

  return clamped;
};

export const normalizeElementForSerialization = (element: Element): Element => {
  if (element.element_type === "narration") {
    const narration = element as NarrationElement;
    const teacherId = resolveNarrationAiTeacherIdFromRecord(
      narration as unknown as Record<string, unknown>,
    );
    const existingTeacherId =
      typeof narration.ai_teacher_id === "string" ? narration.ai_teacher_id.trim() : "";
    const subtitleVisible =
      typeof narration.subtitle_visible === "boolean" ? narration.subtitle_visible : true;
    const needsTeacherFix = existingTeacherId !== teacherId;
    const needsSubtitleFix = narration.subtitle_visible !== subtitleVisible;
    if (!needsTeacherFix && !needsSubtitleFix) return element;
    const metadata = (narration.metadata ?? {}) as Record<string, unknown>;
    return {
      ...narration,
      ...(needsTeacherFix
        ? {
            ai_teacher_id: teacherId,
            metadata: {
              ...metadata,
              ai_teacher_id: teacherId,
              ...(teacherId === UNLINKED_NARRATION_TEACHER_PLACEHOLDER_ID
                ? { ai_teacher_binding_unlinked: true }
                : null),
            } as NarrationElement["metadata"],
          }
        : null),
      subtitle_visible: subtitleVisible,
    };
  }
  if (
    element.element_type === "slide" ||
    element.element_type === "group" ||
    element.element_type === "html"
  ) {
    const container = element as SlideElement | GroupElement | HtmlElement;
    return {
      ...container,
      children_elements: container.children_elements.map((child) =>
        normalizeElementForSerialization(child),
      ),
    } as Element;
  }
  return element;
};

export const deserializeElement = (
  input: unknown,
  options: InternalOptions = {},
  path = "root",
): Element => {
  const issues = options._issues ?? [];
  const node =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const type = typeof node?.element_type === "string" ? node.element_type : undefined;
  const normalizedInput: unknown = {
    action_mappings: {},
    event_scripts: {},
    preset_script: "",
    ...(type === "audio"
      ? { fade_in_ms: 300, fade_out_ms: 300, source_start_at: 0, source_end_at: null }
      : null),
    ...(type === "image"
      ? { source_intrinsic_width: null, source_intrinsic_height: null }
      : null),
    ...(type === "ppt"
      ? { slide_count: 0, slide_ranges: [] }
      : null),
    ...(type === "quiz"
      ? {
          quiz_question_id: "",
        }
      : null),
    ...(type === "quiz_score_summary" ? {} : null),
    ...(type === "rich" ? {} : null),
    ...node,
  };

  if (type === "image") {
    const record = normalizedInput as Record<string, unknown>;
    record.object_fit = deriveImageObjectFit(record);
    record.preserve_aspect_ratio = record.object_fit !== "fill";
  }
  if (type === "text") {
    const record = normalizedInput as Record<string, unknown>;
    record.font_family = coerceTextFontFamily(record.font_family);
  }
  if (type === "narration") {
    const record = normalizedInput as Record<string, unknown>;
    record.ai_teacher_id = resolveNarrationAiTeacherIdFromRecord(record);
    if (typeof record.subtitle_visible !== "boolean") {
      record.subtitle_visible = true;
    }
  }

  try {
    if (!type) {
      throw new Error("missing element_type");
    }
    if (type in scalarSchemas) {
      return validateSchema(
        scalarSchemas[type as keyof typeof scalarSchemas] as yup.Schema<Element>,
        normalizedInput,
      );
    }
    if (type === "quiz") {
      const base = validateSchema(baseSchemaWithUnknown, normalizedInput) as BaseElement;
      const ext = validateSchema(
        yup.object({
          quiz_question_id: yup.string().defined().default(""),
        }),
        normalizedInput,
      );
      return {
        ...base,
        element_type: "quiz",
        quiz_question_id: ext.quiz_question_id,
      };
    }
    if (type === "rich") {
      const base = validateSchema(baseSchemaWithUnknown, normalizedInput) as BaseElement;
      const rawLayout = (normalizedInput as { react_layout?: unknown }).react_layout;
      const reactLayout =
        rawLayout === undefined || rawLayout === null
          ? buildDefaultRichAst()
          : parseRichAstFromJson(rawLayout, `${path}.react_layout`);
      return {
        ...base,
        element_type: "rich",
        react_layout: reactLayout,
      };
    }
    if (type === "quiz_score_summary") {
      const base = validateSchema(baseSchemaWithUnknown, normalizedInput) as BaseElement;
      return {
        ...base,
        element_type: "quiz_score_summary",
      };
    }
    if (type === "rich") {
      const base = validateSchema(baseSchemaWithUnknown, normalizedInput) as BaseElement;
      const rawLayout = (normalizedInput as { react_layout?: unknown }).react_layout;
      const reactLayout =
        rawLayout === undefined || rawLayout === null
          ? buildDefaultRichAst()
          : parseRichAstFromJson(rawLayout, `${path}.react_layout`);
      return {
        ...base,
        element_type: "rich",
        react_layout: reactLayout,
      };
    }
    if (type === "group" || type === "slide") {
      const baseRaw = validateSchema(containerBaseSchemaWithUnknown, normalizedInput) as Record<string, unknown>;
      delete baseRaw.html;
      const base = baseRaw as ContainerElementBase;
      const children = parseChildren(
        (normalizedInput as { children_elements?: unknown }).children_elements,
        `${path}.children_elements`,
        options,
        issues,
      );
      if (type === "group") {
        return { ...base, element_type: "group", children_elements: children };
      }
      const ext = validateSchema(
        yup.object({
          background_color: yup.string().required().default("#000000"),
          background_image_url: yup.string().optional().default(""),
          background_image_fit: yup
            .mixed<SlideBackgroundImageFit>()
            .oneOf([...SLIDE_BACKGROUND_IMAGE_FIT_VALUES])
            .optional()
            .default("cover"),
          background_html_src: yup.string().optional().default(""),
          background_html_content_zoom: yup.number().min(1).max(2.5).optional(),
          flow_pause_points: yup
            .array(
              yup
                .object({
                  pause_id: yup.string().required(),
                  at_ms: yup.number().required().min(0),
                })
                .required(),
            )
            .optional(),
        }),
        normalizedInput,
      );
      return {
        ...base,
        element_type: "slide",
        children_elements: children,
        background_color: ext.background_color,
        background_image_url: ext.background_image_url ?? "",
        background_image_fit: ext.background_image_fit ?? "cover",
        background_html_src: ext.background_html_src ?? "",
        ...(ext.background_html_content_zoom === undefined
          ? {}
          : { background_html_content_zoom: ext.background_html_content_zoom }),
        ...(ext.flow_pause_points?.length
          ? { flow_pause_points: ext.flow_pause_points }
          : {}),
      };
    }
    if (type === "html") {
      const base = validateSchema(baseSchemaWithUnknown, normalizedInput) as BaseElement;
      const children = parseChildren(
        (normalizedInput as { children_elements?: unknown }).children_elements,
        `${path}.children_elements`,
        options,
        issues,
      );
      const ext = validateSchema(
        yup.object({
          src: yup
            .string()
            .required()
            .test(
              "html-src",
              "src must be a data:text/html string or an http/https URL",
              (value) => typeof value === "string" && isSupportedHtmlSrc(value),
            ),
          content_zoom: yup.number().min(1).max(2.5).optional(),
        }),
        normalizedInput,
      );
      return {
        ...base,
        element_type: "html",
        src: ext.src,
        ...(ext.content_zoom === undefined ? {} : { content_zoom: ext.content_zoom }),
        children_elements: children,
        html_event_bindings: parseHtmlBindings(
          (normalizedInput as { html_event_bindings?: unknown }).html_event_bindings,
          `${path}.html_event_bindings`,
          options,
          issues,
        ),
      };
    }
    throw new Error(`unsupported element_type: ${type}`);
  } catch (error) {
    const issue = issueFromError(error, path, input);
    if (!options.skipInvalidNodes) {
      throw new Error(`${issue.path}: ${issue.message}`);
    }
    pushIssue(issues, options, issue);
    const fallback = validateSchema(
      scalarSchemas.text as unknown as yup.Schema<TextElement>,
      {
        element_type: "text",
        text: "[invalid node skipped]",
        name: "invalid-node",
        element_id: newElementId(),
        position: { x: 0, y: 0 },
        size: { width: 0, height: 0 },
        timeline: { start_at: 0, end_at: 0 },
        style: { opacity: 1, rotation_deg: 0, z_index: 0 },
        enter_effect: Effects.NONE,
        exit_effect: Effects.NONE,
        animations: [],
        keyframes: [],
        event_bindings: [],
        action_mappings: {},
        event_scripts: {},
        preset_script: "",
        metadata: { skipped_from_path: path },
        html: "",
        fps: 30,
        font_family: "Inter",
        font_size: 12,
        color: "#FF0000",
        align: "left",
      },
    );
    return fallback;
  }
};

export const deserializeElementWithIssues = (
  input: unknown,
  options: DeserializeOptions = {},
): DeserializeResult<Element> => {
  const issues: ParseIssue[] = [];
  const value = deserializeElement(input, { ...options, _issues: issues }, "root");
  return { value, issues };
};

export const serializeElement = (element: Element): unknown => {
  const issues: ParseIssue[] = [];
  try {
    const prepared = normalizeElementForSerialization(element);
    const clamped = clampElementTimedRangesToTimeline(prepared);
    const normalized = deserializeElement(clamped, { skipInvalidNodes: false }, "serialize_root");
    return stripUndefinedDeep(normalized);
  } catch (error) {
    const issue = issueFromError(error, "serialize_root", element);
    issues.push(issue);
    throw new Error(`${issue.path}: ${issue.message}`);
  } finally {
    if (issues.length > 0) {
      for (const issue of issues) {
        // Serialization failures should always be visible.
        // eslint-disable-next-line no-console
        console.error(`[serializeElement] ${issue.path} -> ${issue.message}`);
      }
    }
  }
};
