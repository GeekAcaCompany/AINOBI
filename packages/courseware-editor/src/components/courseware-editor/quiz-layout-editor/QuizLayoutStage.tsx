// SPDX-License-Identifier: AGPL-3.0-only
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { QuizRenderer } from "@ainobi/courseware-player/components/courseware/quiz/QuizRenderer";
import "./QuizLayoutStage.css";
import type { QuizRuntimeState } from "@ainobi/courseware-player/components/courseware/quiz/QuizFormContext";
import { SlideBackgroundHtmlLayer } from "@ainobi/courseware-player/components/courseware/SlideBackgroundHtmlLayer";
import type { SlideBackgroundImageFit } from "@ainobi/courseware-core/elements.ts";
import { getSlideBackgroundImageLayerStyle } from "@ainobi/courseware-player/lib/courseware/slide-background-image";
import { SLIDE_LOGICAL_WIDTH } from "@ainobi/courseware-player/lib/courseware/slide-cover-layout";
import type { QuizQuestion } from "@ainobi/courseware-core/quiz.ts";
import type { QuizAstNode } from "@ainobi/courseware-core/quiz-ast.ts";
import {
  executeQuizAstDrop,
  getQuizAstNodeAtPath,
  getQuizAstStyleRecord,
  isQuizAstDropContainer,
  isQuizAstRowGroup,
  joinQuizAstPath,
  parseQuizAstPath,
  classifyQuizAstNodeRole,
  resolveQuizAstDragPath,
  resolveQuizAstResizePath,
  resolveQuizAstTextEditPath,
  quizAstHitTestAreaWeight,
  quizInterpEditableField,
  type QuizAstDropPlan,
  type QuizAstPath,
  type QuizInterpEditableField,
} from "@ainobi/courseware-player/lib/courseware/quiz-ast-editor";

import {
  QuizLayoutSelectionOverlay,
  type ResizeHandle,
  type SelectionBox,
} from "./QuizLayoutSelectionOverlay.tsx";

const EDITOR_PREVIEW_STATE: QuizRuntimeState = {
  submitted: false,
  submitting: false,
  earnedScore: null,
  feedback: null,
  canAdvance: false,
  skipped: false,
};

const DRAG_THRESHOLD_PX = 5;
const INSERT_LINE_THICKNESS = 3;
const MIN_RESIZE_PX = 24;
const MIN_SLOT_HEIGHT_PX = 40;
const HORIZONTAL_BUDDY_BAND_PX = 36;
const ROW_BUDDY_MAX_WIDTH_RATIO = 0.82;
/** Blank space at the bottom of the scroll area (design coordinates px), so the last row isn't clipped at the edge */
const SCROLL_BOTTOM_PADDING_DESIGN = 48;
/** Same as the frame's `p-4` */
const FRAME_PADDING_PX = 32;
/** Same as the courseware editor's default slide background */
const DEFAULT_SLIDE_BACKGROUND_COLOR = "#F0F0ED";
/** Auto-scroll triggers when the pointer nears the top/bottom edge of the scroll area */
const EDGE_SCROLL_ZONE_PX = 56;
const EDGE_SCROLL_MAX_SPEED_PX = 18;

interface DropPreview {
  plan: QuizAstDropPlan;
  ok: boolean;
  containerBox: SelectionBox;
  lineBox: SelectionBox | null;
  /** The yield zone currently hit */
  slotBox: SelectionBox | null;
  /** The other droppable gaps within the same container (faint hints while dragging) */
  hintSlots: SelectionBox[];
}

interface DragState {
  fromPath: QuizAstPath;
  startX: number;
  startY: number;
  lastClientX: number;
  lastClientY: number;
  active: boolean;
  pointerId: number;
  grabOffsetX: number;
  grabOffsetY: number;
  hideEl?: HTMLElement;
  prevVisibility?: string;
  followerEl?: HTMLDivElement;
}

interface ResizeState {
  path: QuizAstPath;
  handle: ResizeHandle;
  startX: number;
  startY: number;
  /** Courseware design coordinates (not multiplied by the stage scale) */
  startWidthDesign: number;
  startHeightDesign: number;
  startBoxScreen: SelectionBox;
  pointerId: number;
}

interface ResizeDomPreviewSnapshot {
  el: HTMLElement;
  width: string;
  height: string;
  boxSizing: string;
}

const parseStylePx = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.endsWith("px")) {
      const n = Number.parseFloat(trimmed);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
};

const readDesignDimension = (
  layout: QuizAstNode,
  path: QuizAstPath,
  key: "width" | "height",
  measuredScreen: number,
  scale: number,
): number => {
  const node = getQuizAstNodeAtPath(layout, path);
  if (node) {
    const parsed = parseStylePx(getQuizAstStyleRecord(node)[key]);
    if (parsed != null) return parsed;
  }
  return measuredScreen / Math.max(scale, 0.0001);
};

interface LayoutAxis {
  primary: "x" | "y";
  reverse: boolean;
}

interface ChildEntry {
  path: QuizAstPath;
  index: number;
  rect: DOMRect;
}

const isPrefixPath = (prefix: QuizAstPath, full: QuizAstPath): boolean => {
  const a = parseQuizAstPath(prefix);
  const b = parseQuizAstPath(full);
  if (a.length > b.length) return false;
  return a.every((v, i) => b[i] === v);
};

const isInsideDraggedSubtree = (path: QuizAstPath, fromPath: QuizAstPath): boolean =>
  fromPath !== "" && (path === fromPath || isPrefixPath(fromPath, path));

const unionDomRects = (rects: DOMRectList | DOMRect[]): DOMRect | null => {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < rects.length; i += 1) {
    const r = rects[i]!;
    if (r.width <= 0 && r.height <= 0) continue;
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  if (!Number.isFinite(left)) return null;
  return new DOMRect(left, top, right - left, bottom - top);
};

/** `display: contents` plain text anchors must be measurable too, otherwise hit testing misses option text and similar. */
const measureRect = (el: Element): DOMRect | null => {
  const fromClient = unionDomRects(el.getClientRects());
  if (fromClient && (fromClient.width > 0 || fromClient.height > 0)) return fromClient;

  const rect = el.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) return rect;

  const onlyTextChildren = Array.from(el.childNodes).every(
    (node) =>
      node.nodeType === Node.TEXT_NODE ||
      (node instanceof Element && (node.tagName === "BR" || node.tagName === "SPAN")),
  );
  if (onlyTextChildren && el.childNodes.length > 0) {
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      const textRect = unionDomRects(range.getClientRects());
      if (textRect) return textRect;
    } catch {
      /* noop */
    }
  }

  const child = el.firstElementChild;
  return child ? measureRect(child) : null;
};

const pointInRect = (x: number, y: number, rect: DOMRect): boolean =>
  x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

/** Pixels to scroll per frame when the pointer is at the top/bottom edge of the scroll container (negative up, positive down). */
const edgeScrollDeltaY = (clientY: number, frame: HTMLElement): number => {
  const rect = frame.getBoundingClientRect();
  const yInFrame = clientY - rect.top;
  if (yInFrame < EDGE_SCROLL_ZONE_PX) {
    const t = 1 - Math.max(0, yInFrame) / EDGE_SCROLL_ZONE_PX;
    return -EDGE_SCROLL_MAX_SPEED_PX * t;
  }
  if (yInFrame > rect.height - EDGE_SCROLL_ZONE_PX) {
    const dist = yInFrame - (rect.height - EDGE_SCROLL_ZONE_PX);
    const t = Math.min(1, Math.max(0, dist) / EDGE_SCROLL_ZONE_PX);
    return EDGE_SCROLL_MAX_SPEED_PX * t;
  }
  return 0;
};

const toOverlayBox = (rect: DOMRect, hostRect: DOMRect): SelectionBox => ({
  left: rect.left - hostRect.left,
  top: rect.top - hostRect.top,
  width: rect.width,
  height: rect.height,
});

/** The preview area is scaled on the surface while the overlay layer is outside the container, so font sizes shrink by the same ratio. */
const scaleOverlayPx = (value: string, factor: number): string => {
  const trimmed = value.trim();
  if (trimmed === "normal" || trimmed === "auto") return value;
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(trimmed);
  if (!match) return value;
  return `${Number.parseFloat(match[1]!) * factor}px`;
};

const getDragVisualElement = (frame: HTMLElement, path: QuizAstPath): HTMLElement | null => {
  const anchor = elementForPath(frame, path);
  if (!anchor) return null;
  if (anchor.firstElementChild instanceof HTMLElement) return anchor.firstElementChild;
  return anchor instanceof HTMLElement ? anchor : null;
};

const mountDragFollower = (
  visual: HTMLElement,
  scaleFactor: number,
  container: HTMLElement,
): HTMLDivElement => {
  const containerRect = container.getBoundingClientRect();
  const screenRect = visual.getBoundingClientRect();
  const wrapper = document.createElement("div");
  wrapper.className = "quiz-layout-drag-follower";
  Object.assign(wrapper.style, {
    position: "absolute",
    left: `${screenRect.left - containerRect.left + container.scrollLeft}px`,
    top: `${screenRect.top - containerRect.top + container.scrollTop}px`,
    width: `${screenRect.width}px`,
    height: `${screenRect.height}px`,
    pointerEvents: "none",
    zIndex: "40",
    overflow: "visible",
  });
  const clone = visual.cloneNode(true) as HTMLElement;
  clone.style.pointerEvents = "none";
  clone.style.margin = "0";
  clone.style.visibility = "visible";
  clone.style.opacity = "1";
  if (scaleFactor < 0.999) {
    const designW = visual.offsetWidth;
    const designH = visual.offsetHeight;
    clone.style.width =
      designW > 0 ? `${designW}px` : `${screenRect.width / scaleFactor}px`;
    clone.style.height =
      designH > 0 ? `${designH}px` : `${screenRect.height / scaleFactor}px`;
    clone.style.transform = `scale(${scaleFactor})`;
    clone.style.transformOrigin = "top left";
  }
  wrapper.appendChild(clone);
  return wrapper;
};

const positionDragFollower = (
  wrapper: HTMLDivElement,
  clientX: number,
  clientY: number,
  grabOffsetX: number,
  grabOffsetY: number,
  container: HTMLElement,
): void => {
  const containerRect = container.getBoundingClientRect();
  wrapper.style.left = `${clientX - containerRect.left + container.scrollLeft - grabOffsetX}px`;
  wrapper.style.top = `${clientY - containerRect.top + container.scrollTop - grabOffsetY}px`;
};

const teardownDragSession = (drag: DragState): void => {
  if (drag.hideEl) {
    drag.hideEl.style.visibility = drag.prevVisibility ?? "";
  }
  drag.followerEl?.remove();
};

const scaleTypographyForOverlay = (
  style: CSSProperties,
  factor: number,
): CSSProperties => {
  if (factor >= 0.999 && factor <= 1.001) return style;
  const scaled: CSSProperties = { ...style };
  if (typeof scaled.fontSize === "string") {
    scaled.fontSize = scaleOverlayPx(scaled.fontSize, factor);
  } else if (typeof scaled.fontSize === "number") {
    scaled.fontSize = scaled.fontSize * factor;
  }
  if (typeof scaled.letterSpacing === "string") {
    scaled.letterSpacing = scaleOverlayPx(scaled.letterSpacing, factor);
  }
  if (typeof scaled.lineHeight === "string" && scaled.lineHeight.trim().endsWith("px")) {
    scaled.lineHeight = scaleOverlayPx(scaled.lineHeight, factor);
  }
  for (const key of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"] as const) {
    const value = scaled[key];
    if (typeof value === "string") {
      scaled[key] = scaleOverlayPx(value, factor);
    }
  }
  return scaled;
};

const findInlineTextStyleSource = (
  frame: HTMLElement,
  path: QuizAstPath,
  node: QuizAstNode | null,
): HTMLElement | null => {
  const anchor = elementForPath(frame, path);
  if (node?.kind === "interp") {
    const slot = anchor?.closest("[data-quiz-slot]");
    if (slot instanceof HTMLElement) return slot;
  }
  if (node?.kind === "text") {
    const interactive = anchor?.closest("button, [data-quiz-action], [data-quiz-option]");
    if (interactive instanceof HTMLElement) return interactive;
  }
  const styled = styleTargetForPath(frame, path);
  if (styled) return styled;
  return anchor instanceof HTMLElement ? anchor : null;
};

const boxForInlineEdit = (
  frame: HTMLElement,
  hostRect: DOMRect,
  path: QuizAstPath,
  node: QuizAstNode,
): SelectionBox | null => {
  const anchor = elementForPath(frame, path);
  if (node.kind === "interp") {
    const slot = anchor?.closest("[data-quiz-slot]");
    if (slot instanceof HTMLElement) {
      const slotRect = measureRect(slot);
      if (slotRect) return toOverlayBox(slotRect, hostRect);
    }
  }
  if (node.kind === "text") {
    const interactive = anchor?.closest("button, [data-quiz-action], [data-quiz-option]");
    if (interactive instanceof HTMLElement) {
      const btnRect = measureRect(interactive);
      if (btnRect) return toOverlayBox(btnRect, hostRect);
    }
    if (anchor) {
      const textRect = measureRect(anchor);
      if (textRect) return toOverlayBox(textRect, hostRect);
    }
  }
  if (!anchor) return null;
  const styled = styleTargetForPath(frame, path);
  const rect = measureRect(styled ?? anchor) ?? measureRect(anchor);
  if (!rect) return null;
  return toOverlayBox(rect, hostRect);
};

const resolveLayoutAxis = (cs: CSSStyleDeclaration): LayoutAxis => {
  const display = cs.display;
  if (display.includes("flex")) {
    const dir = cs.flexDirection || "row";
    if (dir.startsWith("row")) return { primary: "x", reverse: dir.includes("reverse") };
    return { primary: "y", reverse: dir.includes("reverse") };
  }
  if (display.includes("grid")) {
    const flow = cs.gridAutoFlow || "row";
    if (flow.startsWith("column")) return { primary: "y", reverse: flow.includes("reverse") };
    return { primary: "x", reverse: flow.includes("reverse") };
  }
  return { primary: "y", reverse: false };
};

const applyReverse = (before: boolean, reverse: boolean): boolean =>
  reverse ? !before : before;

const ancestorPaths = (hitPath: QuizAstPath): QuizAstPath[] => {
  const paths: QuizAstPath[] = [""];
  if (!hitPath) return paths;
  const indices = parseQuizAstPath(hitPath);
  let cur = "";
  for (const idx of indices) {
    cur = joinQuizAstPath(cur, idx);
    paths.push(cur);
  }
  return paths;
};

export interface QuizLayoutSlideBackdrop {
  backgroundColor: string;
  backgroundImageUrl?: string;
  backgroundImageFit?: SlideBackgroundImageFit;
  /** The slide's background HTML source (optional). When set, a full-screen HTML layer is drawn below the elements. */
  backgroundHtmlSrc?: string;
  /** Content zoom of the background HTML (the content_zoom of the original HTML element). */
  backgroundHtmlContentZoom?: number;
  /** Slide ID for the render scale of the background HTML layer. */
  slideId?: string;
}

export interface QuizLayoutStageProps {
  question: QuizQuestion;
  layout: QuizAstNode;
  viewportWidth: number;
  viewportHeight: number;
  slideBackdrop: QuizLayoutSlideBackdrop;
  revision: number;
  selectedPath: QuizAstPath | null;
  interpFieldValues: Record<QuizInterpEditableField, string>;
  onSelectPath: (path: QuizAstPath | null) => void;
  /** Update the preview while typing (not written to the history stack) */
  onPreviewText: (path: QuizAstPath, text: string) => void;
  /** Commit the AST text when editing ends (written to the history stack) */
  onCommitText: (path: QuizAstPath, text: string) => void;
  onCommitField: (field: QuizInterpEditableField, value: string) => void;
  onDrop: (fromPath: QuizAstPath, plan: QuizAstDropPlan) => void;
  onResize: (path: QuizAstPath, width: number, height: number) => void;
}

interface InlineEditState {
  path: QuizAstPath;
  draft: string;
  initialDraft: string;
  box: SelectionBox;
  textStyle: CSSProperties;
  interpField?: QuizInterpEditableField;
}

export function QuizLayoutStage({
  question,
  layout,
  viewportWidth,
  viewportHeight,
  slideBackdrop,
  revision,
  selectedPath,
  interpFieldValues,
  onSelectPath,
  onPreviewText,
  onCommitText,
  onCommitField,
  onDrop,
  onResize,
}: QuizLayoutStageProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const overlayHostRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [frameInner, setFrameInner] = useState({ width: 0, height: 0 });
  const [contentExtent, setContentExtent] = useState({
    width: viewportWidth,
    height: viewportHeight,
  });
  const [hoveredPath, setHoveredPath] = useState<QuizAstPath | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [hoverBox, setHoverBox] = useState<SelectionBox | null>(null);
  const [resizePreviewBox, setResizePreviewBox] = useState<SelectionBox | null>(null);

  const [dragging, setDragging] = useState(false);
  const [dropPreview, setDropPreview] = useState<DropPreview | null>(null);
  const [inlineEdit, setInlineEdit] = useState<InlineEditState | null>(null);

  const dragRef = useRef<DragState | null>(null);
  const inlineEditRef = useRef<HTMLDivElement | null>(null);
  const edgeScrollRafRef = useRef<number | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const resizePreviewRef = useRef<SelectionBox | null>(null);
  const resizeDomPreviewRef = useRef<ResizeDomPreviewSnapshot | null>(null);
  const dropPreviewRef = useRef<DropPreview | null>(null);
  dropPreviewRef.current = dropPreview;

  const liveRef = useRef({ layout, question, onDrop, onResize, scale });
  liveRef.current = { layout, question, onDrop, onResize, scale };

  const clearResizeDomPreview = useCallback((): void => {
    const snap = resizeDomPreviewRef.current;
    if (!snap) return;
    snap.el.style.width = "";
    snap.el.style.height = "";
    snap.el.style.boxSizing = "";
    resizeDomPreviewRef.current = null;
  }, []);

  const applyResizeDomPreview = useCallback((path: QuizAstPath, width: number, height: number): void => {
    const frame = frameRef.current;
    if (!frame) return;
    const target = styleTargetForPath(frame, path);
    if (!target) return;
    if (!resizeDomPreviewRef.current) {
      resizeDomPreviewRef.current = {
        el: target,
        width: target.style.width,
        height: target.style.height,
        boxSizing: target.style.boxSizing,
      };
    }
    target.style.width = `${width}px`;
    target.style.height = `${height}px`;
    target.style.boxSizing = "border-box";
  }, []);

  const previewQuestion = useMemo(
    (): QuizQuestion => ({ ...question, react_layout: layout }),
    [layout, question],
  );

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const updateFrame = (): void => {
      const availW = Math.max(0, frame.clientWidth - FRAME_PADDING_PX);
      const availH = Math.max(0, frame.clientHeight - FRAME_PADDING_PX);
      setFrameInner({ width: availW, height: availH });
      if (availW <= 0 || availH <= 0) return;
      const next = Math.min(availW / viewportWidth, availH / viewportHeight, 1);
      setScale(next > 0 ? next : 1);
    };
    updateFrame();
    const ro = new ResizeObserver(updateFrame);
    ro.observe(frame);
    return () => ro.disconnect();
  }, [viewportWidth, viewportHeight]);

  const overlayHostRect = useCallback((): DOMRect | null => {
    const host = overlayHostRef.current;
    return host ? host.getBoundingClientRect() : null;
  }, []);

  const boxForPath = useCallback((path: QuizAstPath | null): SelectionBox | null => {
    const frame = frameRef.current;
    const hostRect = overlayHostRect();
    if (!frame || !hostRect || path === null) return null;
    const el = elementForPath(frame, path);
    if (!el) return null;
    const styled = styleTargetForPath(frame, path);
    const rect = measureRect(styled ?? el) ?? measureRect(el);
    if (!rect) return null;
    return toOverlayBox(rect, hostRect);
  }, [overlayHostRect]);

  const slideBackgroundImageStyle = useMemo(
    () =>
      getSlideBackgroundImageLayerStyle(
        slideBackdrop.backgroundImageUrl,
        slideBackdrop.backgroundImageFit,
      ),
    [slideBackdrop.backgroundImageFit, slideBackdrop.backgroundImageUrl],
  );

  const resizeTargetPath = useMemo((): QuizAstPath | null => {
    if (!selectedPath) return null;
    return resolveQuizAstResizePath(layout, selectedPath);
  }, [layout, selectedPath]);

  const remeasure = useCallback(() => {
    if (!resizeRef.current) {
      const boxPath = resizeTargetPath ?? selectedPath;
      setSelectionBox(boxForPath(boxPath));
    }
    setHoverBox(
      hoveredPath && hoveredPath !== selectedPath ? boxForPath(hoveredPath) : null,
    );
  }, [boxForPath, hoveredPath, resizeTargetPath, selectedPath]);

  useLayoutEffect(() => {
    remeasure();
  }, [remeasure, revision, scale, layout]);

  // The form in edit mode uses height:auto, sizing the stage and scroll area by scrollHeight (design coordinates)
  useLayoutEffect(() => {
    const host = overlayHostRef.current;
    if (!host) return;
    const measure = (): void => {
      const form = host.querySelector("[data-quiz-container]");
      if (!(form instanceof HTMLElement)) return;
      const contentH = Math.max(viewportHeight, form.scrollHeight);
      const contentW = Math.max(viewportWidth, form.scrollWidth);
      setContentExtent({
        width: contentW,
        height: contentH + SCROLL_BOTTOM_PADDING_DESIGN,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    const form = host.querySelector("[data-quiz-container]");
    if (form) ro.observe(form);
    return () => ro.disconnect();
  }, [layout, revision, viewportHeight, viewportWidth]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onScrollOrResize = (): void => remeasure();
    frame.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      frame.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [remeasure]);

  // selectstart isn't a standard React synthetic event, so a native listener avoids conflicts with dragging/selection
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onSelectStart = (e: Event): void => {
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest(".quiz-layout-resize-handle, .quiz-layout-inline-edit")
      ) {
        return;
      }
      if (!inlineEdit) e.preventDefault();
    };
    frame.addEventListener("selectstart", onSelectStart);
    return () => frame.removeEventListener("selectstart", onSelectStart);
  }, [inlineEdit]);

  const readInlineTextStyle = useCallback((path: QuizAstPath): CSSProperties => {
    const frame = frameRef.current;
    if (!frame) return {};
    const node = getQuizAstNodeAtPath(layout, path);
    const target = findInlineTextStyleSource(frame, path, node);
    if (!target) return {};
    const cs = window.getComputedStyle(target);
    const style: CSSProperties = {
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      color: cs.color,
      textAlign: cs.textAlign as CSSProperties["textAlign"],
      letterSpacing: cs.letterSpacing,
      whiteSpace: cs.whiteSpace as CSSProperties["whiteSpace"],
      wordBreak: cs.wordBreak as CSSProperties["wordBreak"],
      boxSizing: cs.boxSizing as CSSProperties["boxSizing"],
    };
    if (node?.kind === "text" && target.matches("button, [data-quiz-action], [data-quiz-option]")) {
      style.paddingTop = cs.paddingTop;
      style.paddingRight = cs.paddingRight;
      style.paddingBottom = cs.paddingBottom;
      style.paddingLeft = cs.paddingLeft;
    }
    return style;
  }, [layout]);

  const beginInlineEdit = useCallback(
    (path: QuizAstPath): boolean => {
      const node = getQuizAstNodeAtPath(layout, path);
      if (!node) return false;

      let draft = "";
      let interpField: QuizInterpEditableField | undefined;
      if (node.kind === "text") {
        draft = node.text;
      } else if (node.kind === "interp") {
        const field = quizInterpEditableField(node.key);
        if (!field) return false;
        interpField = field;
        draft = interpFieldValues[field];
      } else {
        return false;
      }

      const frame = frameRef.current;
      const hostRect = overlayHostRect();
      const box = frame && hostRect ? boxForInlineEdit(frame, hostRect, path, node) : null;
      if (!box) return false;
      setInlineEdit({
        path,
        draft,
        initialDraft: draft,
        box,
        textStyle: scaleTypographyForOverlay(readInlineTextStyle(path), scale),
        interpField,
      });
      return true;
    },
    [boxForPath, interpFieldValues, layout, overlayHostRect, readInlineTextStyle, scale],
  );

  const finishInlineEdit = useCallback(
    (revert: boolean): void => {
      setInlineEdit((current) => {
        if (!current) return null;
        if (revert) {
          if (current.interpField) {
            onCommitField(current.interpField, current.initialDraft);
          } else {
            onPreviewText(current.path, current.initialDraft);
          }
          return null;
        }
        if (current.interpField) {
          if (current.draft !== current.initialDraft) {
            onCommitField(current.interpField, current.draft);
          }
        } else {
          onCommitText(current.path, current.draft);
        }
        return null;
      });
    },
    [onCommitField, onCommitText, onPreviewText],
  );

  const handleInlineInput = useCallback((): void => {
    const el = inlineEditRef.current;
    if (!el) return;
    const text = el.innerText;
    setInlineEdit((prev) => {
      if (!prev) return null;
      if (prev.interpField) {
        onCommitField(prev.interpField, text);
      } else {
        onPreviewText(prev.path, text);
      }
      return { ...prev, draft: text };
    });
  }, [onCommitField, onPreviewText]);

  useLayoutEffect(() => {
    if (!inlineEdit) return;
    const el = inlineEditRef.current;
    if (!el) return;
    el.textContent = inlineEdit.draft;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [inlineEdit?.path]);

  useLayoutEffect(() => {
    if (!inlineEdit) return;
    const frame = frameRef.current;
    if (!frame) return;
    const hideEl = resolveInlineEditHideTarget(frame, inlineEdit.path, layout);
    if (!hideEl) return;
    const prevVisibility = hideEl.style.visibility;
    hideEl.style.visibility = "hidden";
    return () => {
      hideEl.style.visibility = prevVisibility;
    };
  }, [inlineEdit?.path, layout]);

  const findPathFromDomAncestors = useCallback(
    (clientX: number, clientY: number): QuizAstPath | null => {
      const frame = frameRef.current;
      if (!frame) return null;
      let el = document.elementFromPoint(clientX, clientY);
      let bestPath: QuizAstPath | null = null;
      let bestDepth = -1;
      while (el && el !== frame) {
        if (el instanceof HTMLElement && el.dataset.quizAstPath !== undefined) {
          const path = el.getAttribute("data-quiz-ast-path") ?? "";
          const depth = parseQuizAstPath(path).length;
          if (depth > bestDepth) {
            bestDepth = depth;
            bestPath = path;
          }
        }
        el = el.parentElement;
      }
      return bestPath;
    },
    [],
  );

  const findDeepestPathAtPoint = useCallback(
    (clientX: number, clientY: number, fromPath: QuizAstPath): QuizAstPath | null => {
      const frame = frameRef.current;
      if (!frame) return null;

      let bestPath: QuizAstPath | null = null;
      let bestScore = Number.POSITIVE_INFINITY;

      const consider = (path: QuizAstPath, el: Element | null): void => {
        if (!el || isInsideDraggedSubtree(path, fromPath)) return;
        const rect = measureRect(el);
        if (!rect || !pointInRect(clientX, clientY, rect)) return;
        const node = getQuizAstNodeAtPath(layout, path);
        const weight = node ? quizAstHitTestAreaWeight(node, path) : 1;
        const score = rect.width * rect.height * weight;
        if (score < bestScore) {
          bestScore = score;
          bestPath = path;
        }
      };

      for (const anchor of frame.querySelectorAll("[data-quiz-ast-path]")) {
        const path = anchor.getAttribute("data-quiz-ast-path");
        if (path === null) continue;
        consider(path, anchor);
      }

      if (!bestPath) {
        const domPath = findPathFromDomAncestors(clientX, clientY);
        if (domPath && !isInsideDraggedSubtree(domPath, fromPath)) {
          bestPath = domPath;
        }
      }

      return bestPath;
    },
    [findPathFromDomAncestors, layout],
  );

  const openTextEditAtPoint = useCallback(
    (clientX: number, clientY: number): void => {
      const hitPath = findDeepestPathAtPoint(clientX, clientY, "");
      const editPath = hitPath ? resolveQuizAstTextEditPath(layout, hitPath) : null;
      if (editPath) {
        onSelectPath(editPath);
        beginInlineEdit(editPath);
        return;
      }
      if (hitPath) onSelectPath(hitPath);
    },
    [beginInlineEdit, findDeepestPathAtPoint, layout, onSelectPath],
  );

  const gatherChildEntries = useCallback((parentPath: QuizAstPath): ChildEntry[] => {
      const frame = frameRef.current;
      if (!frame) return [];
      const prefix = parentPath === "" ? "" : `${parentPath}.`;
      const entries: ChildEntry[] = [];
      for (let i = 0; ; i += 1) {
        const path = `${prefix}children[${i}]`;
        const el = elementForPath(frame, path);
        if (!el) break;
        const rect = measureRect(el);
        if (!rect) break;
        entries.push({ path, index: i, rect });
      }
      return entries;
  }, []);

  const buildSiblingLineBox = (
    hitRect: DOMRect,
    frameRect: DOMRect,
    axis: LayoutAxis,
    insertBefore: boolean,
  ): SelectionBox => {
    const t = INSERT_LINE_THICKNESS;
    if (axis.primary === "x") {
      const x = insertBefore ? hitRect.left : hitRect.right;
      return {
        left: x - frameRect.left - t / 2,
        top: hitRect.top - frameRect.top,
        width: t,
        height: hitRect.height,
      };
    }
    const y = insertBefore ? hitRect.top : hitRect.bottom;
    return {
      left: hitRect.left - frameRect.left,
      top: y - frameRect.top - t / 2,
      width: hitRect.width,
      height: t,
    };
  };

  const buildGapLineBox = (
    childRects: DOMRect[],
    index: number,
    frameRect: DOMRect,
    containerRect: DOMRect,
    axis: LayoutAxis,
  ): SelectionBox | null => {
    const t = INSERT_LINE_THICKNESS;
    if (childRects.length === 0) return null;
    if (axis.primary === "y") {
      const yScreen =
        index === 0
          ? childRects[0]!.top
          : childRects[Math.min(index, childRects.length) - 1]!.bottom;
      return {
        left: containerRect.left - frameRect.left,
        top: yScreen - frameRect.top - t / 2,
        width: containerRect.width,
        height: t,
      };
    }
    const xScreen =
      index === 0
        ? childRects[0]!.left
        : childRects[Math.min(index, childRects.length) - 1]!.right;
    return {
      left: xScreen - frameRect.left - t / 2,
      top: containerRect.top - frameRect.top,
      width: t,
      height: containerRect.height,
    };
  };

  /** In column layout, scan siblings for a side-by-side intent (independent of the deepest hit path). */
  const findHorizontalBuddyAmongSiblings = (
    entries: ChildEntry[],
    clientX: number,
    clientY: number,
    fromPath: QuizAstPath,
    parentRect: DOMRect,
  ): { anchorPath: QuizAstPath; side: "left" | "right"; anchorRect: DOMRect } | null => {
    const visible = entries.filter((e) => e.path !== fromPath);
    let best: { anchorPath: QuizAstPath; side: "left" | "right"; anchorRect: DOMRect } | null =
      null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let i = 0; i < visible.length; i += 1) {
      const entry = visible[i]!;
      const r = entry.rect;
      if (r.width >= parentRect.width * ROW_BUDDY_MAX_WIDTH_RATIO) continue;

      const prev = visible[i - 1];
      const next = visible[i + 1];
      const fromIsNextBelow = next?.path === fromPath;
      const fromIsPrevAbove = prev?.path === fromPath;

      let spanTop = r.top - 8;
      let spanBottom = r.bottom + 8;
      if (fromIsNextBelow && next) {
        spanBottom = Math.max(spanBottom, next.rect.bottom + 8);
      }
      if (fromIsPrevAbove && prev) {
        spanTop = Math.min(spanTop, prev.rect.top - 8);
      }
      if (clientY < spanTop || clientY > spanBottom) continue;

      const band = Math.max(HORIZONTAL_BUDDY_BAND_PX, Math.min(r.width * 0.35, 96));
      const hReach = Math.max(band * 2, r.width * 0.6);
      const inRightZone =
        (clientX >= r.left + r.width * 0.42 && clientX <= r.right + hReach) ||
        (clientX >= r.right - 6 && clientX <= Math.min(parentRect.right, r.right + hReach));
      const inLeftZone =
        (clientX <= r.left + r.width * 0.58 && clientX >= r.left - hReach) ||
        (clientX <= r.left + 6 && clientX >= Math.max(parentRect.left, r.left - hReach));

      const pick = (side: "left" | "right", score: number): void => {
        if (score < bestScore) {
          bestScore = score;
          best = { anchorPath: entry.path, side, anchorRect: r };
        }
      };

      if (inRightZone && !inLeftZone) {
        pick("right", Math.abs(clientX - r.right));
      } else if (inLeftZone && !inRightZone) {
        pick("left", Math.abs(clientX - r.left));
      }
    }
    return best;
  };

  const buildVerticalSlotRects = (
    entries: ChildEntry[],
    parentRect: DOMRect,
    fromPath: QuizAstPath,
    frameRect: DOMRect,
  ): Array<{ index: number; slotRect: DOMRect; lineBox: SelectionBox }> => {
    const visible = entries.filter((e) => e.path !== fromPath);
    const slots: Array<{ index: number; slotRect: DOMRect; lineBox: SelectionBox }> = [];

    for (let i = 0; i <= visible.length; i += 1) {
      const astIndex =
        i < visible.length ? visible[i]!.index : (visible[visible.length - 1]?.index ?? -1) + 1;

      let yTop: number;
      let yBottom: number;
      if (visible.length === 0) {
        yTop = parentRect.top;
        yBottom = parentRect.bottom;
      } else if (i === 0) {
        yTop = parentRect.top;
        yBottom = visible[0]!.rect.top;
      } else if (i === visible.length) {
        yTop = visible[visible.length - 1]!.rect.bottom;
        yBottom = parentRect.bottom;
      } else {
        yTop = visible[i - 1]!.rect.bottom;
        yBottom = visible[i]!.rect.top;
      }

      const center = (yTop + yBottom) / 2;
      const half = Math.max(MIN_SLOT_HEIGHT_PX / 2, (yBottom - yTop) / 2 + 10);
      const slotTop = Math.max(parentRect.top, center - half);
      const slotBottom = Math.min(parentRect.bottom, center + half);

      const slotRect = new DOMRect(
        parentRect.left,
        slotTop,
        parentRect.width,
        Math.max(8, slotBottom - slotTop),
      );
      const lineY = i === 0 ? visible[0]?.rect.top ?? center : i === visible.length ? yTop : center;
      slots.push({
        index: astIndex,
        slotRect,
        lineBox: {
          left: parentRect.left - frameRect.left,
          top: lineY - frameRect.top - INSERT_LINE_THICKNESS / 2,
          width: parentRect.width,
          height: INSERT_LINE_THICKNESS,
        },
      });
    }
    return slots;
  };

  const insertAmongChildren = (
    entries: ChildEntry[],
    clientX: number,
    clientY: number,
    axis: LayoutAxis,
    frameRect: DOMRect,
    containerRect: DOMRect,
    fromPath: QuizAstPath,
  ): { index: number; lineBox: SelectionBox | null; slotBox: SelectionBox | null } => {
    const visible = entries.filter((e) => e.path !== fromPath);
    if (visible.length === 0) {
      return { index: 0, lineBox: null, slotBox: toOverlayBox(containerRect, frameRect) };
    }

    for (let i = 0; i < visible.length; i += 1) {
      const entry = visible[i]!;
      const r = entry.rect;
      const mid = axis.primary === "y" ? r.top + r.height / 2 : r.left + r.width / 2;
      const pointer = axis.primary === "y" ? clientY : clientX;
      const before = applyReverse(pointer < mid, axis.reverse);
      if (before) {
        const gapTop = i === 0 ? containerRect.top : visible[i - 1]!.rect.bottom;
        const gapBottom = r.top;
        const slotRect = new DOMRect(
          containerRect.left,
          gapTop,
          containerRect.width,
          Math.max(8, gapBottom - gapTop),
        );
        return {
          index: entry.index,
          lineBox: buildSiblingLineBox(r, frameRect, axis, true),
          slotBox: toOverlayBox(slotRect, frameRect),
        };
      }
    }
    const last = visible[visible.length - 1]!;
    const gapTop = last.rect.bottom;
    const slotRect = new DOMRect(
      containerRect.left,
      gapTop,
      containerRect.width,
      Math.max(8, containerRect.bottom - gapTop),
    );
    return {
      index: last.index + 1,
      lineBox:
        buildGapLineBox(
          visible.map((e) => e.rect),
          visible.length,
          frameRect,
          containerRect,
          axis,
        ) ?? buildSiblingLineBox(last.rect, frameRect, axis, false),
      slotBox: toOverlayBox(slotRect, frameRect),
    };
  };

  const planKey = (plan: QuizAstDropPlan): string =>
    plan.kind === "horizontal-buddy"
      ? `h:${plan.anchorPath}:${plan.side}`
      : `c:${plan.parentPath}:${plan.index}`;

  const resolveInsertion = useCallback(
    (
      clientX: number,
      clientY: number,
      fromPath: QuizAstPath,
    ): Omit<DropPreview, "ok"> | null => {
      const frame = frameRef.current;
      const host = overlayHostRef.current;
      if (!frame || !host) return null;
      const hostRect = host.getBoundingClientRect();
      const hitPath = findDeepestPathAtPoint(clientX, clientY, fromPath);
      const parents = ancestorPaths(hitPath ?? "");

      for (let i = parents.length - 1; i >= 0; i -= 1) {
        const parentPath = parents[i]!;
        const parentNode = getQuizAstNodeAtPath(liveRef.current.layout, parentPath);
        if (!isQuizAstDropContainer(parentNode)) continue;

        const parentEl = containerElementForPath(frame, parentPath);
        if (!parentEl) continue;

        const containerRect = parentEl.getBoundingClientRect();
        if (!pointInRect(clientX, clientY, containerRect)) continue;

        const axis = resolveLayoutAxis(window.getComputedStyle(parentEl));
        const entries = gatherChildEntries(parentPath);
        const containerBox = toOverlayBox(containerRect, hostRect);

        // Column layout: scan siblings to detect side-by-side placement (wraps in a row automatically)
        if (axis.primary === "y" && !isQuizAstRowGroup(parentNode)) {
          const buddy = findHorizontalBuddyAmongSiblings(
            entries,
            clientX,
            clientY,
            fromPath,
            containerRect,
          );
          if (buddy) {
            const { anchorRect, anchorPath, side } = buddy;
            const bandW = Math.max(
              HORIZONTAL_BUDDY_BAND_PX,
              Math.min(anchorRect.width * 0.35, 120),
            );
            const slotLeft = side === "right" ? anchorRect.right - bandW : anchorRect.left;
            const slotRect = new DOMRect(
              slotLeft,
              anchorRect.top,
              bandW,
              anchorRect.height,
            );
            const activeSlot = toOverlayBox(slotRect, hostRect);
            return {
              plan: { kind: "horizontal-buddy", anchorPath, side },
              containerBox,
              lineBox: buildSiblingLineBox(
                anchorRect,
                hostRect,
                { primary: "x", reverse: false },
                side === "left",
              ),
              slotBox: activeSlot,
              hintSlots: [],
            };
          }
        }

        // Row layout: insert children left/right
        if (axis.primary === "x") {
          const { index, lineBox, slotBox } = insertAmongChildren(
            entries,
            clientX,
            clientY,
            axis,
            hostRect,
            containerRect,
            fromPath,
          );
          return {
            plan: { kind: "container", parentPath, index },
            containerBox,
            lineBox,
            slotBox,
            hintSlots: [],
          };
        }

        // Column layout: enlarged yield slots above and below
        const slots = buildVerticalSlotRects(entries, containerRect, fromPath, hostRect);
        const allHintSlots = slots.map((s) => toOverlayBox(s.slotRect, hostRect));
        for (const slot of slots) {
          if (pointInRect(clientX, clientY, slot.slotRect)) {
            const active = toOverlayBox(slot.slotRect, hostRect);
            return {
              plan: { kind: "container", parentPath, index: slot.index },
              containerBox,
              lineBox: slot.lineBox,
              slotBox: active,
              hintSlots: allHintSlots.filter(
                (h) =>
                  h.left !== active.left ||
                  h.top !== active.top ||
                  h.width !== active.width ||
                  h.height !== active.height,
              ),
            };
          }
        }

        // Landing on a child without triggering horizontal placement: above/below by the midline
        const { index, lineBox, slotBox } = insertAmongChildren(
          entries,
          clientX,
          clientY,
          axis,
          hostRect,
          containerRect,
          fromPath,
        );
        return {
          plan: { kind: "container", parentPath, index },
          containerBox,
          lineBox,
          slotBox,
          hintSlots: slotBox
            ? allHintSlots.filter(
                (h) =>
                  h.left !== slotBox.left ||
                  h.top !== slotBox.top ||
                  h.width !== slotBox.width ||
                  h.height !== slotBox.height,
              )
            : allHintSlots,
        };
      }
      return null;
    },
    [findDeepestPathAtPoint, gatherChildEntries],
  );

  const computeDropPreview = useCallback(
    (clientX: number, clientY: number, fromPath: QuizAstPath): DropPreview | null => {
      const insertion = resolveInsertion(clientX, clientY, fromPath);
      if (!insertion) return null;

      const { layout: liveLayout, question: liveQuestion } = liveRef.current;
      const prev = dropPreviewRef.current;
      const key = planKey(insertion.plan);
      const ok =
        prev && planKey(prev.plan) === key
          ? prev.ok
          : executeQuizAstDrop(liveLayout, liveQuestion, fromPath, insertion.plan) !== null;

      return { ...insertion, ok };
    },
    [resolveInsertion],
  );

  const stopEdgeAutoScroll = useCallback((): void => {
    if (edgeScrollRafRef.current !== null) {
      cancelAnimationFrame(edgeScrollRafRef.current);
      edgeScrollRafRef.current = null;
    }
  }, []);

  const syncEdgeAutoScroll = useCallback((): void => {
    if (edgeScrollRafRef.current !== null) return;
    const tick = (): void => {
      const drag = dragRef.current;
      const frame = frameRef.current;
      if (!drag?.active || !frame) {
        edgeScrollRafRef.current = null;
        return;
      }
      const delta = edgeScrollDeltaY(drag.lastClientY, frame);
      if (delta === 0) {
        edgeScrollRafRef.current = null;
        return;
      }
      const prevTop = frame.scrollTop;
      frame.scrollTop += delta;
      if (frame.scrollTop !== prevTop) {
        if (drag.followerEl) {
          positionDragFollower(
            drag.followerEl,
            drag.lastClientX,
            drag.lastClientY,
            drag.grabOffsetX,
            drag.grabOffsetY,
            frame,
          );
        }
        setDropPreview(
          computeDropPreview(drag.lastClientX, drag.lastClientY, drag.fromPath),
        );
      }
      edgeScrollRafRef.current = requestAnimationFrame(tick);
    };
    edgeScrollRafRef.current = requestAnimationFrame(tick);
  }, [computeDropPreview]);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent): void => {
      const resize = resizeRef.current;
      if (resize && e.pointerId === resize.pointerId) {
        e.preventDefault();
        const scaleFactor = liveRef.current.scale || 1;
        const dx = (e.clientX - resize.startX) / scaleFactor;
        const dy = (e.clientY - resize.startY) / scaleFactor;
        let widthDesign = resize.startWidthDesign;
        let heightDesign = resize.startHeightDesign;
        let left = resize.startBoxScreen.left;
        let top = resize.startBoxScreen.top;

        if (resize.handle.includes("e")) widthDesign = resize.startWidthDesign + dx;
        if (resize.handle.includes("w")) widthDesign = resize.startWidthDesign - dx;
        if (resize.handle.includes("s")) heightDesign = resize.startHeightDesign + dy;
        if (resize.handle.includes("n")) heightDesign = resize.startHeightDesign - dy;

        widthDesign = Math.max(MIN_RESIZE_PX, Math.round(widthDesign));
        heightDesign = Math.max(MIN_RESIZE_PX, Math.round(heightDesign));

        if (resize.handle.includes("w")) {
          left =
            resize.startBoxScreen.left +
            (resize.startWidthDesign - widthDesign) * scaleFactor;
        }
        if (resize.handle.includes("n")) {
          top =
            resize.startBoxScreen.top +
            (resize.startHeightDesign - heightDesign) * scaleFactor;
        }

        const next: SelectionBox = {
          left,
          top,
          width: widthDesign * scaleFactor,
          height: heightDesign * scaleFactor,
        };
        resizePreviewRef.current = next;
        setResizePreviewBox(next);
        applyResizeDomPreview(resize.path, widthDesign, heightDesign);
        return;
      }

      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;

      if (!drag.active) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD_PX) {
          return;
        }
        drag.active = true;
        setDragging(true);
        setHoveredPath(null);
        frameRef.current?.setPointerCapture(e.pointerId);
        const frame = frameRef.current;
        if (frame) {
          const visual = getDragVisualElement(frame, drag.fromPath);
          if (visual) {
            drag.followerEl = mountDragFollower(
              visual,
              liveRef.current.scale || 1,
              frame,
            );
            frame.appendChild(drag.followerEl);
            drag.hideEl = visual;
            drag.prevVisibility = visual.style.visibility;
            visual.style.visibility = "hidden";
            positionDragFollower(
              drag.followerEl,
              e.clientX,
              e.clientY,
              drag.grabOffsetX,
              drag.grabOffsetY,
              frame,
            );
          }
        }
      }

      e.preventDefault();
      drag.lastClientX = e.clientX;
      drag.lastClientY = e.clientY;
      const frame = frameRef.current;
      if (drag.followerEl && frame) {
        positionDragFollower(
          drag.followerEl,
          e.clientX,
          e.clientY,
          drag.grabOffsetX,
          drag.grabOffsetY,
          frame,
        );
      }
      setDropPreview(computeDropPreview(e.clientX, e.clientY, drag.fromPath));
      syncEdgeAutoScroll();
    };

    const onPointerUp = (e: PointerEvent): void => {
      const resize = resizeRef.current;
      if (resize && e.pointerId === resize.pointerId) {
        resizeRef.current = null;
        try {
          frameRef.current?.releasePointerCapture(e.pointerId);
        } catch {
          /* noop */
        }
        const preview = resizePreviewRef.current;
        const scaleFactor = liveRef.current.scale || 1;
        resizePreviewRef.current = null;
        setResizePreviewBox(null);
        clearResizeDomPreview();
        if (preview) {
          liveRef.current.onResize(
            resize.path,
            Math.round(preview.width / scaleFactor),
            Math.round(preview.height / scaleFactor),
          );
        }
        remeasure();
        return;
      }

      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      stopEdgeAutoScroll();
      try {
        frameRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      if (drag.active) {
        const preview = dropPreviewRef.current;
        if (preview?.ok) {
          liveRef.current.onDrop(drag.fromPath, preview.plan);
        }
        teardownDragSession(drag);
      }
      setDragging(false);
      setDropPreview(null);
    };

    document.addEventListener("pointermove", onPointerMove, { passive: false });
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerUp);
    return () => {
      stopEdgeAutoScroll();
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerUp);
    };
  }, [
    applyResizeDomPreview,
    boxForPath,
    clearResizeDomPreview,
    computeDropPreview,
    remeasure,
    stopEdgeAutoScroll,
    syncEdgeAutoScroll,
  ]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (resizeRef.current) return;

      const hitPath = findDeepestPathAtPoint(e.clientX, e.clientY, "");
      onSelectPath(hitPath);

      const fromPath = hitPath ? resolveQuizAstDragPath(layout, hitPath) : null;
      if (!fromPath) return;
      const node = getQuizAstNodeAtPath(layout, fromPath);
      if (node?.kind !== "element") return;

      const frame = frameRef.current;
      const visual = frame ? getDragVisualElement(frame, fromPath) : null;
      const rect = visual ? measureRect(visual) : null;
      if (!rect) return;

      dragRef.current = {
        fromPath,
        startX: e.clientX,
        startY: e.clientY,
        lastClientX: e.clientX,
        lastClientY: e.clientY,
        active: false,
        pointerId: e.pointerId,
        grabOffsetX: e.clientX - rect.left,
        grabOffsetY: e.clientY - rect.top,
      };
    },
    [findDeepestPathAtPoint, layout, onSelectPath],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = null;
      openTextEditAtPoint(e.clientX, e.clientY);
    },
    [openTextEditAtPoint],
  );

  const handleResizeStart = useCallback(
    (handle: ResizeHandle, e: React.PointerEvent) => {
      if (!resizeTargetPath) return;
      const box = boxForPath(resizeTargetPath);
      if (!box) return;
      const scaleFactor = scale || 1;
      resizeRef.current = {
        path: resizeTargetPath,
        handle,
        startX: e.clientX,
        startY: e.clientY,
        startWidthDesign: readDesignDimension(
          layout,
          resizeTargetPath,
          "width",
          box.width,
          scaleFactor,
        ),
        startHeightDesign: readDesignDimension(
          layout,
          resizeTargetPath,
          "height",
          box.height,
          scaleFactor,
        ),
        startBoxScreen: box,
        pointerId: e.pointerId,
      };
      dragRef.current = null;
      resizePreviewRef.current = box;
      setResizePreviewBox(box);
      frameRef.current?.setPointerCapture(e.pointerId);
    },
    [boxForPath, layout, resizeTargetPath, scale],
  );

  const handlePointerMoveHover = useCallback(
    (e: React.PointerEvent) => {
      if (dragRef.current || resizeRef.current) return;
      const hitPath = findDeepestPathAtPoint(e.clientX, e.clientY, "");
      setHoveredPath(hitPath && hitPath !== "" ? hitPath : null);
    },
    [findDeepestPathAtPoint],
  );

  const canResize = resizeTargetPath !== null && !dragging && !inlineEdit;

  const scaledContentWidth = contentExtent.width * scale;
  const scaledContentHeight = contentExtent.height * scale;
  const hostWidth = scaledContentWidth;
  const hostHeight = Math.max(
    scaledContentHeight,
    frameInner.height > 0 ? frameInner.height : scaledContentHeight,
  );

  return (
    <div
      ref={frameRef}
      className={`quiz-layout-editor-frame relative h-full w-full overflow-auto p-4${dragging ? " is-dragging" : ""}${inlineEdit ? " is-inline-editing" : ""}`}
      style={dragging ? { cursor: "grabbing", userSelect: "none" } : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMoveHover}
      onPointerLeave={() => setHoveredPath(null)}
    >
      <div
        ref={overlayHostRef}
        className={`relative mx-auto shrink-0 rounded-lg shadow-md ring-1 ring-slate-300/80 dark:shadow-black/40 dark:ring-slate-600/70${canResize || dragging ? " overflow-visible" : " overflow-hidden"}`}
        style={{ width: hostWidth, height: hostHeight }}
        onDoubleClick={handleDoubleClick}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundColor:
              slideBackdrop.backgroundColor.trim() || DEFAULT_SLIDE_BACKGROUND_COLOR,
          }}
        >
          {slideBackgroundImageStyle ? (
            <div className="absolute inset-0" style={slideBackgroundImageStyle} />
          ) : null}
          <SlideBackgroundHtmlLayer
            src={slideBackdrop.backgroundHtmlSrc}
            slideId={slideBackdrop.slideId ?? "quiz-layout"}
            contentZoom={slideBackdrop.backgroundHtmlContentZoom}
            scale={hostWidth / SLIDE_LOGICAL_WIDTH}
            targetSizePx={{ width: hostWidth, height: hostHeight }}
            zClassName="z-0"
          />
        </div>
        <div
          className="quiz-layout-editor-surface absolute left-0 top-0 z-1 overflow-visible"
          style={{
            width: viewportWidth,
            minHeight: viewportHeight,
            height: contentExtent.height,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <QuizRenderer
            question={previewQuestion}
            state={EDITOR_PREVIEW_STATE}
            editorMode
            containerStyle={{
              width: viewportWidth,
              minHeight: viewportHeight,
              height: "auto",
              maxHeight: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div className="pointer-events-none absolute inset-0 z-2 overflow-visible">
        {!dragging && hoverBox ? (
          <div
            className="quiz-layout-hover-ring absolute rounded-sm"
            style={{
              left: hoverBox.left,
              top: hoverBox.top,
              width: hoverBox.width,
              height: hoverBox.height,
            }}
          />
        ) : null}

        {dragging && dropPreview ? (
          <>
            {dropPreview.hintSlots.map((hint, idx) => (
              <div
                key={`hint-${idx}`}
                className="absolute rounded border border-dashed border-green-500/25"
                style={{
                  left: hint.left,
                  top: hint.top,
                  width: hint.width,
                  height: hint.height,
                  backgroundColor: "rgba(34,197,94,0.06)",
                }}
              />
            ))}
            {dropPreview.slotBox ? (
              <div
                className="absolute rounded border border-dashed"
                style={{
                  left: dropPreview.slotBox.left,
                  top: dropPreview.slotBox.top,
                  width: dropPreview.slotBox.width,
                  height: dropPreview.slotBox.height,
                  backgroundColor: dropPreview.ok
                    ? "rgba(34,197,94,0.22)"
                    : "rgba(239,68,68,0.18)",
                  borderColor: dropPreview.ok
                    ? "rgba(34,197,94,0.9)"
                    : "rgba(239,68,68,0.85)",
                }}
              />
            ) : null}
            {dropPreview.ok && dropPreview.lineBox ? (
              <div
                className="absolute rounded-sm shadow-sm"
                style={{
                  left: dropPreview.lineBox.left,
                  top: dropPreview.lineBox.top,
                  width: dropPreview.lineBox.width,
                  height: dropPreview.lineBox.height,
                  backgroundColor: "rgb(34,197,94)",
                }}
              />
            ) : null}
          </>
        ) : null}
      </div>

        {!dragging && canResize ? (
          <div className="pointer-events-none absolute inset-0 z-20 overflow-visible">
            <QuizLayoutSelectionOverlay
              box={selectionBox}
              previewBox={resizePreviewBox}
              onResizeStart={handleResizeStart}
            />
          </div>
        ) : null}

        {inlineEdit ? (
          <div
            ref={inlineEditRef}
            role="textbox"
            contentEditable
            suppressContentEditableWarning
            className="quiz-layout-inline-edit pointer-events-auto absolute z-30"
            style={{
              left: inlineEdit.box.left,
              top: inlineEdit.box.top,
              width: Math.max(inlineEdit.box.width, 8),
              minHeight: Math.max(inlineEdit.box.height, 20),
              ...inlineEdit.textStyle,
            }}
            onInput={handleInlineInput}
            onBlur={() => finishInlineEdit(false)}
            onPointerDown={(ev) => ev.stopPropagation()}
            onKeyDown={(ev) => {
              if (ev.key === "Escape") {
                ev.preventDefault();
                finishInlineEdit(true);
              }
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

const elementForPath = (frame: HTMLElement, path: QuizAstPath): Element | null => {
  if (path === "") return frame.querySelector("[data-quiz-container]");
  return frame.querySelector(`[data-quiz-ast-path="${path.replace(/"/g, '\\"')}"]`);
};

/** `display:contents` wrapper layers don't take part in layout; styles should apply to the real children. */
const styleTargetForPath = (frame: HTMLElement, path: QuizAstPath): HTMLElement | null => {
  const anchor = elementForPath(frame, path);
  if (!anchor) return null;
  const child = anchor.firstElementChild;
  if (child instanceof HTMLElement) return child;
  return anchor instanceof HTMLElement ? anchor : null;
};

const containerElementForPath = (frame: HTMLElement, path: QuizAstPath): Element | null => {
  if (path === "") return frame.querySelector("[data-quiz-container]");
  const anchor = frame.querySelector(`[data-quiz-ast-path="${path.replace(/"/g, '\\"')}"]`);
  return anchor?.firstElementChild ?? anchor;
};

/** Hide the underlying rendered text during in-place editing, so it doesn't double with the contentEditable. */
const resolveInlineEditHideTarget = (
  frame: HTMLElement,
  path: QuizAstPath,
  layout: QuizAstNode,
): HTMLElement | null => {
  const node = getQuizAstNodeAtPath(layout, path);
  const anchor = elementForPath(frame, path);
  if (!(anchor instanceof HTMLElement)) return null;
  // Hide only the AST text anchors, keeping parent shells such as buttons/cards
  if (node?.kind === "text" || node?.kind === "interp") {
    return anchor;
  }
  const styled = styleTargetForPath(frame, path);
  if (styled) return styled;
  return anchor;
};
