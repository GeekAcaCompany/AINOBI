// SPDX-License-Identifier: AGPL-3.0-only
import type { SvgElement } from "@ainobi/courseware-player/lib/courseware/index";
import { CoursewareInternalEditHint } from "../CoursewareInternalEditHint.tsx";
import {
  EditorOverlapPickerMenu,
  type EditorOverlapPickTarget,
} from "../../courseware-editor/EditorOverlapPickerMenu.tsx";
import type { SvgTextStylePatch } from "@ainobi/courseware-player/lib/courseware/svg-text-style";
import {
  applySvgTextStylePatch,
  isSvgTextNode,
  readSvgTextStyleSnapshot,
  syncInlineSvgTextEditorPresentation,
} from "@ainobi/courseware-player/lib/courseware/svg-text-style";
import {
  applySvgEditHighlights,
  applySvgResizeDrag,
  applySvgTextContent,
  applyTextElementPositionDelta,
  beginSvgResizeCapture,
  childPath,
  clearSvgEditHighlights,
  clientPointToSvg,
  findNodePath,
  describeSvgNodeForOverlapPicker,
  getElementRectInContainer,
  getGenericResizeChromeRectInContainer,
  getUnionElementRectInContainer,
  getFocusContainer,
  getNodeAtPath,
  hitTestFocusChildIndex,
  hitTestFocusChildIndexes,
  isInlineSvgSource,
  isSvgContainerElement,
  isSvgPathSelected,
  isSvgTextElement,
  mountInlineSvgTextEditor,
  normalizeSvgSelectionPath,
  nudgeSvgNodePosition,
  parseTransformTranslate,
  pathKey,
  readTextElementPosition,
  removeNodesAtPaths,
  resolveGraphicsElementForLayout,
  resolveTextElement,
  serializeInlineSvgMarkup,
  setTransformTranslate,
  SVG_RESIZE_HANDLES,
  svgResizeCursor,
  toggleSvgPathSelection,
  unmountInlineSvgTextEditor,
  type InlineSvgTextEditorSession,
  type SvgNodePath,
  type SvgResizeCapture,
  type SvgResizeHandle,
} from "@ainobi/courseware-player/lib/courseware/svg-edit";
import { readActiveEditorThemeMode } from "@ainobi/courseware-player/lib/courseware-editor-theme";
import { useI18nNew } from "@ainobi/courseware-player/hooks/useI18nNew";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

function isInlineSvgMarkup(source: string): boolean {
  return isInlineSvgSource(source);
}

interface MoveDragBase {
  path: SvgNodePath;
  baseTranslate: { x: number; y: number };
  textBase?: ReturnType<typeof readTextElementPosition>;
}

interface MoveDragState {
  kind: "move";
  pointerId: number;
  startClientX: number;
  startClientY: number;
  bases: MoveDragBase[];
}

interface ResizeDragState {
  kind: "resize";
  path: SvgNodePath;
  pointerId: number;
  capture: SvgResizeCapture;
  lastClientX: number;
  lastClientY: number;
}

type PointerDragState = MoveDragState | ResizeDragState;

export interface CoursewareSvgEditState {
  focusPath: SvgNodePath;
  selectedPaths: SvgNodePath[];
  textEditPath: SvgNodePath | null;
}

interface CoursewareSvgStageEditorProps {
  element: SvgElement;
  className?: string;
  style?: CSSProperties;
  editable?: boolean;
  editState?: CoursewareSvgEditState;
  onEditStateChange?: (next: CoursewareSvgEditState) => void;
  onSourceChange?: (source: string, options?: { recordHistory?: boolean }) => void;
  onExitEdit?: () => void;
  /** Bust layout when the outer stage zoom/pan changes so selection chrome stays aligned. */
  layoutSyncKey?: string;
  onSvgTextStyleSnapshot?: (snapshot: ReturnType<typeof readSvgTextStyleSnapshot> | null) => void;
  svgTextStylePatch?: { nonce: number; patch: SvgTextStylePatch } | null;
}

export function CoursewareSvgStageEditor({
  element,
  className = "h-full w-full",
  style,
  editable = false,
  editState = { focusPath: [], selectedPaths: [], textEditPath: null },
  onEditStateChange,
  onSourceChange,
  onExitEdit,
  layoutSyncKey = "",
  onSvgTextStyleSnapshot,
  svgTextStylePatch = null,
}: CoursewareSvgStageEditorProps) {
  const { t, language } = useI18nNew();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const appliedMarkupRef = useRef<string | null>(null);
  const domDirtyRef = useRef(false);
  const dragRef = useRef<PointerDragState | null>(null);
  const textSessionRef = useRef<InlineSvgTextEditorSession | null>(null);
  const selectionChromeRef = useRef<HTMLDivElement | null>(null);
  const syncFrameRef = useRef<number | null>(null);
  const lastStylePatchNonceRef = useRef<number | null>(null);
  const styleCommitTimerRef = useRef<number | null>(null);
  const onSourceChangeRef = useRef(onSourceChange);
  const onSvgTextStyleSnapshotRef = useRef(onSvgTextStyleSnapshot);
  const onEditStateChangeRef = useRef(onEditStateChange);
  const editStateRef = useRef(editState);
  const [selectedIsText, setSelectedIsText] = useState(false);
  const [overlapMenu, setOverlapMenu] = useState<{
    x: number;
    y: number;
    targets: EditorOverlapPickTarget[];
  } | null>(null);

  const { focusPath, selectedPaths, textEditPath } = editState;
  const primarySelectedPath = selectedPaths[0] ?? null;

  editStateRef.current = editState;
  onSourceChangeRef.current = onSourceChange;
  onSvgTextStyleSnapshotRef.current = onSvgTextStyleSnapshot;
  onEditStateChangeRef.current = onEditStateChange;

  const patchEditState = useCallback((patch: Partial<CoursewareSvgEditState>) => {
    onEditStateChangeRef.current?.({ ...editStateRef.current, ...patch });
  }, []);

  const commitSource = useCallback((options?: { recordHistory?: boolean }) => {
    const host = hostRef.current;
    if (!host) return;
    const svg = host.querySelector("svg");
    if (svg instanceof SVGSVGElement) clearSvgEditHighlights(svg);
    const serialized = serializeInlineSvgMarkup(host);
    if (!serialized) return;
    domDirtyRef.current = false;
    appliedMarkupRef.current = serialized;
    onSourceChangeRef.current?.(serialized, options);
  }, []);

  const scheduleStyleCommit = useCallback(() => {
    if (styleCommitTimerRef.current !== null) {
      window.clearTimeout(styleCommitTimerRef.current);
    }
    styleCommitTimerRef.current = window.setTimeout(() => {
      styleCommitTimerRef.current = null;
      commitSource({ recordHistory: true });
    }, 250);
  }, [commitSource]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (appliedMarkupRef.current === element.source) return;
    domDirtyRef.current = false;
    dragRef.current = null;
    appliedMarkupRef.current = element.source;
    host.innerHTML = element.source;
    const svg = host.querySelector("svg");
    if (svg instanceof SVGSVGElement) clearSvgEditHighlights(svg);
  }, [element.source]);

  const getSvgRoot = useCallback((): SVGSVGElement | null => {
    return hostRef.current?.querySelector("svg") ?? null;
  }, []);

  const syncSelectionChrome = useCallback(() => {
    const chrome = selectionChromeRef.current;
    const container = containerRef.current;
    const svg = getSvgRoot();
    if (!chrome) return;
    if (!container || !svg || selectedPaths.length === 0 || textEditPath) {
      chrome.style.display = "none";
      return;
    }
    const nodes = selectedPaths
      .map((path) => getNodeAtPath(svg, path))
      .filter((node): node is Element => node !== null);
    if (nodes.length === 0) {
      chrome.style.display = "none";
      return;
    }
    const drag = dragRef.current;
    const genericCapture =
      drag?.kind === "resize" ? drag.capture.generic : null;
    const genericResize = Boolean(genericCapture) && selectedPaths.length === 1;
    const rect =
      genericResize && drag?.kind === "resize" && primarySelectedPath
        ? getGenericResizeChromeRectInContainer(
            container,
            genericCapture!,
            drag.capture.handle,
            drag.lastClientX,
            drag.lastClientY,
          ) ??
          getUnionElementRectInContainer(nodes, container) ??
          getElementRectInContainer(nodes[0]!, container)
        : getUnionElementRectInContainer(nodes, container) ??
          getElementRectInContainer(nodes[0]!, container);
    if (!rect || (rect.width <= 0 && rect.height <= 0)) {
      chrome.style.display = "none";
      return;
    }
    chrome.style.display = "block";
    chrome.style.left = `${rect.left}px`;
    chrome.style.top = `${rect.top}px`;
    chrome.style.width = `${rect.width}px`;
    chrome.style.height = `${rect.height}px`;
  }, [getSvgRoot, primarySelectedPath, selectedPaths, textEditPath]);

  const scheduleSyncSelectionChrome = useCallback(() => {
    if (syncFrameRef.current !== null) return;
    syncFrameRef.current = requestAnimationFrame(() => {
      syncFrameRef.current = null;
      syncSelectionChrome();
    });
  }, [syncSelectionChrome]);

  useEffect(() => {
    return () => {
      if (syncFrameRef.current !== null) {
        cancelAnimationFrame(syncFrameRef.current);
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (!editable) return;
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => scheduleSyncSelectionChrome());
    observer.observe(container);
    const host = hostRef.current;
    if (host) observer.observe(host);
    return () => observer.disconnect();
  }, [editable, scheduleSyncSelectionChrome]);

  useLayoutEffect(() => {
    syncSelectionChrome();
  }, [layoutSyncKey, syncSelectionChrome]);

  useLayoutEffect(() => {
    const svg = getSvgRoot();
    const next =
      svg && primarySelectedPath
        ? isSvgTextNode(getNodeAtPath(svg, primarySelectedPath))
        : false;
    setSelectedIsText((prev) => (prev === next ? prev : next));
  }, [primarySelectedPath, getSvgRoot]);

  useLayoutEffect(() => {
    if (!editable) return;
    const svg = getSvgRoot();
    if (!svg) return;
    applySvgEditHighlights(svg, focusPath, selectedPaths);
    syncSelectionChrome();
    return () => clearSvgEditHighlights(svg);
  }, [editable, focusPath, selectedPaths, element.source, getSvgRoot, syncSelectionChrome]);

  useLayoutEffect(() => {
    if (!editable || !textEditPath) {
      return;
    }
    const svg = getSvgRoot();
    if (!svg) return;
    const node = getNodeAtPath(svg, textEditPath);
    const textEl = node ? resolveTextElement(node) : null;
    if (!textEl) return;

    domDirtyRef.current = true;
    const session = mountInlineSvgTextEditor(textEl, {
      onInput: (text) => {
        applySvgTextContent(textEl, text);
        domDirtyRef.current = true;
      },
      onCommit: () => {
        if (!textSessionRef.current) return;
        textSessionRef.current.commit();
        textSessionRef.current = null;
        patchEditState({ textEditPath: null });
        onSvgTextStyleSnapshotRef.current?.(null);
        commitSource({ recordHistory: true });
      },
    });
    textSessionRef.current = session;
    queueMicrotask(() => {
      onSvgTextStyleSnapshotRef.current?.(readSvgTextStyleSnapshot(textEl));
    });
    requestAnimationFrame(() => session.focus());

    return () => {
      if (textSessionRef.current) {
        textSessionRef.current.commit();
        textSessionRef.current = null;
      } else {
        unmountInlineSvgTextEditor(textEl);
      }
    };
  }, [editable, textEditPath, getSvgRoot, patchEditState, commitSource]);

  useLayoutEffect(() => {
    if (!editable || !svgTextStylePatch) return;
    const targetPath =
      textEditPath ??
      (selectedIsText && primarySelectedPath ? primarySelectedPath : null);
    if (!targetPath) return;
    if (lastStylePatchNonceRef.current === svgTextStylePatch.nonce) return;
    lastStylePatchNonceRef.current = svgTextStylePatch.nonce;
    const svg = getSvgRoot();
    if (!svg) return;
    const node = getNodeAtPath(svg, targetPath);
    const textEl = node ? resolveTextElement(node) : null;
    if (!textEl) return;
    applySvgTextStylePatch(textEl, svgTextStylePatch.patch);
    syncInlineSvgTextEditorPresentation(textEl);
    domDirtyRef.current = true;
    queueMicrotask(() => {
      onSvgTextStyleSnapshotRef.current?.(readSvgTextStyleSnapshot(textEl));
    });
    scheduleStyleCommit();
  }, [
    editable,
    svgTextStylePatch,
    textEditPath,
    selectedPaths,
    primarySelectedPath,
    selectedIsText,
    getSvgRoot,
    scheduleStyleCommit,
  ]);

  useEffect(() => {
    lastStylePatchNonceRef.current = null;
  }, [textEditPath, primarySelectedPath, selectedPaths]);

  useEffect(() => {
    return () => {
      if (styleCommitTimerRef.current !== null) {
        window.clearTimeout(styleCommitTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!editable) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Delete" || event.key === "Backspace") {
        if (editStateRef.current.textEditPath) return;
        const paths = editStateRef.current.selectedPaths;
        if (paths.length === 0) return;
        const svg = getSvgRoot();
        if (!svg) return;
        event.preventDefault();
        event.stopPropagation();
        removeNodesAtPaths(svg, paths);
        patchEditState({ selectedPaths: [], textEditPath: null });
        onSvgTextStyleSnapshotRef.current?.(null);
        commitSource({ recordHistory: true });
        return;
      }

      if (
        !editStateRef.current.textEditPath &&
        editStateRef.current.selectedPaths.length > 0 &&
        (event.key === "ArrowUp" ||
          event.key === "ArrowDown" ||
          event.key === "ArrowLeft" ||
          event.key === "ArrowRight")
      ) {
        let dx = 0;
        let dy = 0;
        if (event.key === "ArrowUp") dy = -1;
        else if (event.key === "ArrowDown") dy = 1;
        else if (event.key === "ArrowLeft") dx = -1;
        else if (event.key === "ArrowRight") dx = 1;
        const step = event.shiftKey ? 10 : 1;
        const svg = getSvgRoot();
        if (!svg) return;
        event.preventDefault();
        event.stopPropagation();
        for (const path of editStateRef.current.selectedPaths) {
          const node = getNodeAtPath(svg, path);
          if (!node) continue;
          nudgeSvgNodePosition(node, dx * step, dy * step);
        }
        scheduleSyncSelectionChrome();
        commitSource({ recordHistory: true });
        return;
      }

      if (event.key !== "Escape") return;
      if (textEditPath) {
        event.preventDefault();
        textSessionRef.current?.commit();
        textSessionRef.current = null;
        patchEditState({ textEditPath: null });
        onSvgTextStyleSnapshotRef.current?.(null);
        commitSource({ recordHistory: true });
        return;
      }
      if (focusPath.length > 0) {
        event.preventDefault();
        patchEditState({
          focusPath: focusPath.slice(0, -1),
          selectedPaths: [],
          textEditPath: null,
        });
        return;
      }
      event.preventDefault();
      onExitEdit?.();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [editable, focusPath, textEditPath, patchEditState, commitSource, onExitEdit, getSvgRoot, scheduleSyncSelectionChrome]);

  const handleOverlayContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!editable || textEditPath) return;
    event.preventDefault();
    event.stopPropagation();
    const svg = getSvgRoot();
    if (!svg) return;
    const focus = getFocusContainer(svg, focusPath);
    const indexes = hitTestFocusChildIndexes(focus, svg, event.clientX, event.clientY);
    if (indexes.length === 0) {
      setOverlapMenu(null);
      patchEditState({ selectedPaths: [] });
      onSvgTextStyleSnapshotRef.current?.(null);
      return;
    }
    const targets = indexes.map((index) => {
      const path = normalizeSvgSelectionPath(svg, childPath(focusPath, index));
      const node = getNodeAtPath(svg, path);
      return {
        id: pathKey(path),
        label: node
          ? describeSvgNodeForOverlapPicker(node, language)
          : t("coursewareEditor.stage.layerN", { index: index + 1 }),
      };
    });
    const topPath = normalizeSvgSelectionPath(svg, childPath(focusPath, indexes[0]!));
    patchEditState({ selectedPaths: [topPath], textEditPath: null });
    const topNode = getNodeAtPath(svg, topPath);
    if (topNode && isSvgTextNode(topNode)) {
      const textEl = resolveTextElement(topNode);
      queueMicrotask(() => {
        onSvgTextStyleSnapshotRef.current?.(
          textEl ? readSvgTextStyleSnapshot(textEl) : null,
        );
      });
    } else {
      onSvgTextStyleSnapshotRef.current?.(null);
    }
    if (targets.length === 1) {
      setOverlapMenu(null);
      return;
    }
    setOverlapMenu({ x: event.clientX, y: event.clientY, targets });
  };

  const handleOverlayPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!editable || textEditPath) return;
    setOverlapMenu(null);
    event.stopPropagation();
    const svg = getSvgRoot();
    if (!svg) return;
    const focus = getFocusContainer(svg, focusPath);
    const index = hitTestFocusChildIndex(focus, svg, event.clientX, event.clientY);
    if (index === null) {
      patchEditState({ selectedPaths: [] });
      onSvgTextStyleSnapshotRef.current?.(null);
      return;
    }
    const path = normalizeSvgSelectionPath(svg, childPath(focusPath, index));
    const node = getNodeAtPath(svg, path);
    if (!node || !resolveGraphicsElementForLayout(node)) return;
    const toggle = event.metaKey || event.ctrlKey || event.shiftKey;
    const nextPaths = toggleSvgPathSelection(editStateRef.current.selectedPaths, path, {
      toggle,
      keepGroupOnReselect: true,
    });
    patchEditState({ selectedPaths: nextPaths, textEditPath: null });
    if (nextPaths.length === 1 && isSvgTextNode(node)) {
      const textEl = resolveTextElement(node);
      queueMicrotask(() => {
        onSvgTextStyleSnapshotRef.current?.(
          textEl ? readSvgTextStyleSnapshot(textEl) : null,
        );
      });
    } else {
      onSvgTextStyleSnapshotRef.current?.(null);
    }
    const dragPaths = isSvgPathSelected(nextPaths, path) ? nextPaths : [path];
    const bases: MoveDragBase[] = [];
    for (const dragPath of dragPaths) {
      const dragNode = getNodeAtPath(svg, dragPath);
      const graphics = dragNode ? resolveGraphicsElementForLayout(dragNode) : null;
      if (!dragNode || !graphics) continue;
      const textEl = isSvgTextElement(graphics) ? (graphics as SVGTextElement) : null;
      bases.push({
        path: dragPath,
        baseTranslate: parseTransformTranslate(graphics.getAttribute("transform")),
        textBase: textEl ? readTextElementPosition(textEl) : undefined,
      });
    }
    if (bases.length === 0) return;
    dragRef.current = {
      kind: "move",
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      bases,
    };
    domDirtyRef.current = true;
    overlayRef.current?.setPointerCapture(event.pointerId);
  };

  const handleResizePointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    handle: SvgResizeHandle,
  ) => {
    if (!editable || textEditPath || selectedPaths.length !== 1 || !primarySelectedPath) return;
    event.stopPropagation();
    event.preventDefault();
    const svg = getSvgRoot();
    if (!svg) return;
    const node = getNodeAtPath(svg, primarySelectedPath);
    const graphics = node ? resolveGraphicsElementForLayout(node) : null;
    if (!graphics) return;
    dragRef.current = {
      kind: "resize",
      path: primarySelectedPath,
      pointerId: event.pointerId,
      capture: beginSvgResizeCapture(graphics, handle, event.clientX, event.clientY),
      lastClientX: event.clientX,
      lastClientY: event.clientY,
    };
    domDirtyRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || textEditPath) return;
    event.stopPropagation();
    const svg = getSvgRoot();
    if (!svg) return;

    if (drag.kind === "move") {
      const start = clientPointToSvgLocal(svg, drag.startClientX, drag.startClientY);
      const current = clientPointToSvgLocal(svg, event.clientX, event.clientY);
      const dx = current.x - start.x;
      const dy = current.y - start.y;
      for (const base of drag.bases) {
        const node = getNodeAtPath(svg, base.path);
        const graphics = node ? resolveGraphicsElementForLayout(node) : null;
        if (!node || !graphics) continue;
        if (base.textBase && isSvgTextElement(graphics)) {
          applyTextElementPositionDelta(
            graphics as SVGTextElement,
            { x: dx, y: dy },
            base.textBase,
          );
        } else {
          setTransformTranslate(graphics, {
            x: base.baseTranslate.x + dx,
            y: base.baseTranslate.y + dy,
          });
        }
      }
    } else {
      const node = getNodeAtPath(svg, drag.path);
      const graphics = node ? resolveGraphicsElementForLayout(node) : null;
      if (!node || !graphics) return;
      drag.lastClientX = event.clientX;
      drag.lastClientY = event.clientY;
      applySvgResizeDrag(graphics, drag.capture, event.clientX, event.clientY);
    }
    scheduleSyncSelectionChrome();
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    dragRef.current = null;
    try {
      if (drag.kind === "move") {
        overlayRef.current?.releasePointerCapture(event.pointerId);
      } else {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // ignore
    }
    syncSelectionChrome();
    commitSource({ recordHistory: true });
  };

  const handleDoubleClick = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!editable || textEditPath) return;
    event.stopPropagation();
    const svg = getSvgRoot();
    if (!svg) return;
    const focus = getFocusContainer(svg, focusPath);
    const index = hitTestFocusChildIndex(focus, svg, event.clientX, event.clientY);
    if (index === null) return;
    const path = normalizeSvgSelectionPath(svg, childPath(focusPath, index));
    const node = getNodeAtPath(svg, path);
    if (!node) return;

    const textEl = resolveTextElement(node);
    if (textEl && (isSvgTextElement(node) || node.localName.toLowerCase() === "tspan")) {
      const textPath = findNodePath(svg, textEl) ?? path;
      patchEditState({ selectedPaths: [textPath], textEditPath: textPath });
      queueMicrotask(() => {
        onSvgTextStyleSnapshotRef.current?.(readSvgTextStyleSnapshot(textEl));
      });
      return;
    }

    if (isSvgContainerElement(node)) {
      patchEditState({
        focusPath: path,
        selectedPaths: [],
        textEditPath: null,
      });
    }
  };

  const source = element.source.trim();
  const objectFit = element.preserve_aspect_ratio ? "contain" : "fill";

  if (!source) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center rounded-md border border-dashed border-slate-600 bg-slate-900/70 px-3 text-center text-slate-300">
        <span className="text-xs">{t("coursewareEditor.stage.svgNoContent")}</span>
      </div>
    );
  }

  if (!isInlineSvgMarkup(source)) {
    return (
      <img
        src={source}
        alt={element.name}
        className={className}
        style={{ objectFit, ...style }}
        draggable={false}
      />
    );
  }

  const inlineSvgClass = element.preserve_aspect_ratio
    ? "[&_svg]:max-h-full [&_svg]:max-w-full [&_svg]:h-auto [&_svg]:w-auto"
    : "[&_svg]:h-full [&_svg]:w-full";

  const showSelectionChrome = selectedPaths.length > 0 && !textEditPath;
  const showResizeHandles =
    showSelectionChrome && selectedPaths.length === 1 && !selectedIsText;

  return (
    <div
      ref={containerRef}
      className={`relative flex items-center justify-center overflow-visible ${className}`}
      style={style}
    >
      <div
        ref={hostRef}
        className={`flex h-full w-full items-center justify-center ${inlineSvgClass}`}
      />
      {editable ? (
        <>
          <div
            ref={overlayRef}
            className="absolute inset-0 z-10 cursor-default"
            style={{ pointerEvents: textEditPath ? "none" : "auto" }}
            onPointerDown={handleOverlayPointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onDoubleClick={handleDoubleClick}
            onContextMenu={handleOverlayContextMenu}
          />
          <div
            ref={selectionChromeRef}
            className="pointer-events-none absolute z-20 border-2 border-blue-500"
            style={{ display: "none" }}
          >
            {showResizeHandles
              ? SVG_RESIZE_HANDLES.map((handle) => (
                <div
                  key={handle}
                  className="pointer-events-auto absolute z-30 h-3 w-3 rounded-sm border border-white bg-blue-500 shadow"
                  style={{
                    left:
                      handle.includes("w")
                        ? -6
                        : handle.includes("e")
                          ? "calc(100% - 6px)"
                          : "calc(50% - 6px)",
                    top:
                      handle.includes("n")
                        ? -6
                        : handle.includes("s")
                          ? "calc(100% - 6px)"
                          : "calc(50% - 6px)",
                    cursor: svgResizeCursor(handle),
                  }}
                  onPointerDown={(event) => handleResizePointerDown(event, handle)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                />
              ))
                : null}
          </div>
          {focusPath.length > 0 ? (
            <CoursewareInternalEditHint title={t("coursewareEditor.stage.escReturnTitle")}>
              {t("coursewareEditor.stage.layerBreadcrumb", {
                path: focusPath.map((index) => index + 1).join(" › "),
              })}
            </CoursewareInternalEditHint>
          ) : (
            <CoursewareInternalEditHint>
              {t("coursewareEditor.stage.svgEditHint")}
            </CoursewareInternalEditHint>
          )}
          {textEditPath ? (
            <div
              className="pointer-events-none absolute inset-0 z-[15]"
              onPointerDown={(event) => event.stopPropagation()}
            />
          ) : null}
        </>
      ) : null}
      <EditorOverlapPickerMenu
        anchor={overlapMenu ? { x: overlapMenu.x, y: overlapMenu.y } : null}
        targets={overlapMenu?.targets ?? []}
        activeId={primarySelectedPath ? pathKey(primarySelectedPath) : null}
        themeMode={readActiveEditorThemeMode()}
        onClose={() => setOverlapMenu(null)}
        onPick={(id) => {
          const path = id.split(".").map((part) => Number.parseInt(part, 10));
          if (!path.every(Number.isFinite)) return;
          patchEditState({ selectedPaths: [path], textEditPath: null });
          const svg = getSvgRoot();
          const node = svg ? getNodeAtPath(svg, path) : null;
          if (node && isSvgTextNode(node)) {
            const textEl = resolveTextElement(node);
            onSvgTextStyleSnapshotRef.current?.(
              textEl ? readSvgTextStyleSnapshot(textEl) : null,
            );
          } else {
            onSvgTextStyleSnapshotRef.current?.(null);
          }
          setOverlapMenu(null);
        }}
      />
    </div>
  );
}

function clientPointToSvgLocal(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const local = clientPointToSvg(svg, clientX, clientY);
  return { x: local.x, y: local.y };
}

export function defaultSvgEditState(): CoursewareSvgEditState {
  return { focusPath: [], selectedPaths: [], textEditPath: null };
}

export function svgEditStateKey(state: CoursewareSvgEditState): string {
  const selected = state.selectedPaths.map((path) => pathKey(path)).join(",");
  return `${pathKey(state.focusPath)}|${selected}|${state.textEditPath ? pathKey(state.textEditPath) : ""}`;
}
