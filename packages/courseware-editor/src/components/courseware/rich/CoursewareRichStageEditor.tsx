// SPDX-License-Identifier: AGPL-3.0-only
import type { RichElement } from "@ainobi/courseware-player/lib/courseware/index";
import {
  applyRichEditHighlights,
  applyRichResizeDrag,
  beginRichResizeCapture,
  buildRichMarginNudgePatch,
  childPath,
  clearRichEditHighlights,
  focusPathAfterRichNodeDelete,
  describeRichNodeForOverlapPicker,
  getDomElementAtPath,
  getDomRectInContainer,
  getRichAstNodeAtPath,
  getRichHitElementAtClientPoint,
  hitTestRichFocusChildIndex,
  hitTestRichFocusChildIndexes,
  isRichContainerNode,
  isRichElementNode,
  pathKey,
  removeRichNodeAtPath,
  resolveRichSelectionPathFromHit,
  SVG_RESIZE_HANDLES,
  svgResizeCursor,
  type RichNodePath,
  type RichResizeCapture,
  type SvgResizeHandle,
} from "../../../lib/courseware/rich-edit.ts";
import { CoursewareInternalEditHint } from "../CoursewareInternalEditHint.tsx";
import {
  EditorOverlapPickerMenu,
  type EditorOverlapPickTarget,
} from "../../courseware-editor/EditorOverlapPickerMenu.tsx";
import { RichRenderer } from "@ainobi/courseware-player/components/courseware/rich/RichRenderer";
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

interface ResizeDragState {
  kind: "resize";
  path: RichNodePath;
  pointerId: number;
  capture: RichResizeCapture;
}

export interface CoursewareRichEditState {
  focusPath: RichNodePath;
  selectedPath: RichNodePath | null;
  textEditPath: RichNodePath | null;
}

interface CoursewareRichStageEditorProps {
  element: RichElement;
  scale: number;
  widthLogical: number;
  heightLogical: number;
  className?: string;
  style?: CSSProperties;
  editState?: CoursewareRichEditState;
  onEditStateChange?: (next: CoursewareRichEditState) => void;
  onLayoutChange?: (
    path: RichNodePath,
    patch: Record<string, string | number | null>,
    options?: { recordHistory?: boolean },
  ) => void;
  onRemoveNode?: (path: RichNodePath, options?: { recordHistory?: boolean }) => void;
  onTextChange?: (path: RichNodePath, text: string) => void;
  onSelectRichText?: (path: RichNodePath) => void;
  onExitEdit?: () => void;
  layoutSyncKey?: string;
}

export function CoursewareRichStageEditor({
  element,
  scale,
  widthLogical,
  heightLogical,
  className = "h-full w-full",
  style,
  editState = { focusPath: [], selectedPath: null, textEditPath: null },
  onEditStateChange,
  onLayoutChange,
  onRemoveNode,
  onTextChange,
  onSelectRichText,
  onExitEdit,
  layoutSyncKey = "",
}: CoursewareRichStageEditorProps) {
  const { t, language } = useI18nNew();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const selectionChromeRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<ResizeDragState | null>(null);
  const syncFrameRef = useRef<number | null>(null);
  const editStateRef = useRef(editState);
  const onEditStateChangeRef = useRef(onEditStateChange);
  const onLayoutChangeRef = useRef(onLayoutChange);
  const onRemoveNodeRef = useRef(onRemoveNode);
  const onTextChangeRef = useRef(onTextChange);
  const onSelectRichTextRef = useRef(onSelectRichText);
  const resizePatchRef = useRef<{ width: string; height: string; boxSizing: string } | null>(null);
  const [overlapMenu, setOverlapMenu] = useState<{
    x: number;
    y: number;
    targets: EditorOverlapPickTarget[];
  } | null>(null);

  const { focusPath, selectedPath, textEditPath } = editState;

  editStateRef.current = editState;
  onEditStateChangeRef.current = onEditStateChange;
  onLayoutChangeRef.current = onLayoutChange;
  onRemoveNodeRef.current = onRemoveNode;
  onTextChangeRef.current = onTextChange;
  onSelectRichTextRef.current = onSelectRichText;

  const patchEditState = useCallback((patch: Partial<CoursewareRichEditState>) => {
    onEditStateChangeRef.current?.({ ...editStateRef.current, ...patch });
  }, []);

  const getRootElement = useCallback((): HTMLElement | null => rootRef.current, []);

  const syncSelectionChrome = useCallback(() => {
    const chrome = selectionChromeRef.current;
    const container = containerRef.current;
    const root = getRootElement();
    if (!chrome || !container || !root || !selectedPath || textEditPath) {
      if (chrome) chrome.style.display = "none";
      return;
    }
    const node = getDomElementAtPath(root, selectedPath);
    if (!node) {
      chrome.style.display = "none";
      return;
    }
    const rect = getDomRectInContainer(node, container);
    if (!rect || (rect.width <= 0 && rect.height <= 0)) {
      chrome.style.display = "none";
      return;
    }
    chrome.style.display = "block";
    chrome.style.left = `${rect.left}px`;
    chrome.style.top = `${rect.top}px`;
    chrome.style.width = `${rect.width}px`;
    chrome.style.height = `${rect.height}px`;
  }, [getRootElement, selectedPath, textEditPath]);

  const scheduleSyncSelectionChrome = useCallback(() => {
    if (syncFrameRef.current !== null) return;
    syncFrameRef.current = requestAnimationFrame(() => {
      syncFrameRef.current = null;
      syncSelectionChrome();
    });
  }, [syncSelectionChrome]);

  useEffect(() => {
    return () => {
      if (syncFrameRef.current !== null) cancelAnimationFrame(syncFrameRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => scheduleSyncSelectionChrome());
    observer.observe(container);
    const root = getRootElement();
    if (root) observer.observe(root);
    return () => observer.disconnect();
  }, [getRootElement, scheduleSyncSelectionChrome]);

  useLayoutEffect(() => {
    syncSelectionChrome();
  }, [layoutSyncKey, syncSelectionChrome]);

  useLayoutEffect(() => {
    const root = getRootElement();
    if (!root) return;
    applyRichEditHighlights(root, focusPath, selectedPath);
    syncSelectionChrome();
    return () => clearRichEditHighlights(root);
  }, [focusPath, selectedPath, getRootElement, syncSelectionChrome, element.react_layout]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const state = editStateRef.current;
      if (event.key === "Delete" || event.key === "Backspace") {
        if (state.textEditPath) return;
        const path = state.selectedPath;
        if (!path || path.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        onRemoveNodeRef.current?.(path, { recordHistory: true });
        patchEditState({
          focusPath: focusPathAfterRichNodeDelete(state.focusPath, path),
          selectedPath: null,
          textEditPath: null,
        });
        return;
      }

      if (
        !state.textEditPath &&
        state.selectedPath &&
        state.selectedPath.length > 0 &&
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
        const patch = buildRichMarginNudgePatch(
          element.react_layout,
          state.selectedPath,
          dx * step,
          dy * step,
        );
        if (!patch) return;
        event.preventDefault();
        event.stopPropagation();
        onLayoutChangeRef.current?.(state.selectedPath, patch, { recordHistory: true });
        scheduleSyncSelectionChrome();
        return;
      }

      if (event.key !== "Escape") return;
      if (state.textEditPath) {
        event.preventDefault();
        patchEditState({ textEditPath: null });
        return;
      }
      if (state.focusPath.length > 0) {
        event.preventDefault();
        patchEditState({
          focusPath: state.focusPath.slice(0, -1),
          selectedPath: null,
          textEditPath: null,
        });
        return;
      }
      event.preventDefault();
      onExitEdit?.();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [element.react_layout, patchEditState, onExitEdit, scheduleSyncSelectionChrome]);

  const handleOverlayContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if (textEditPath) return;
    event.preventDefault();
    event.stopPropagation();
    const root = getRootElement();
    if (!root) return;
    const indexes = hitTestRichFocusChildIndexes(root, focusPath, event.clientX, event.clientY);
    if (indexes.length === 0) {
      setOverlapMenu(null);
      patchEditState({ selectedPath: null });
      return;
    }
    const targets = indexes.map((index) => {
      const path = childPath(focusPath, index);
      const astNode = getRichAstNodeAtPath(element.react_layout, path);
      return {
        id: pathKey(path),
        label: describeRichNodeForOverlapPicker(astNode, language),
      };
    });
    const topPath = childPath(focusPath, indexes[0]!);
    patchEditState({ selectedPath: topPath, textEditPath: null });
    if (targets.length === 1) {
      setOverlapMenu(null);
      return;
    }
    setOverlapMenu({ x: event.clientX, y: event.clientY, targets });
  };

  const handleOverlayPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (textEditPath) return;
    setOverlapMenu(null);
    event.stopPropagation();
    const root = getRootElement();
    if (!root) return;

    const hit = getRichHitElementAtClientPoint(root, event.clientX, event.clientY);
    if (!hit) {
      patchEditState({ selectedPath: null });
      return;
    }

    const selectionPath = resolveRichSelectionPathFromHit(hit, focusPath);
    if (!selectionPath) {
      const index = hitTestRichFocusChildIndex(root, focusPath, event.clientX, event.clientY);
      if (index === null) {
        patchEditState({ selectedPath: null });
        return;
      }
      patchEditState({ selectedPath: childPath(focusPath, index), textEditPath: null });
      return;
    }

    patchEditState({ selectedPath: selectionPath, textEditPath: null });
  };

  const handleResizePointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    handle: SvgResizeHandle,
  ) => {
    if (textEditPath || !selectedPath) return;
    event.stopPropagation();
    event.preventDefault();
    const root = getRootElement();
    if (!root) return;
    const node = getDomElementAtPath(root, selectedPath);
    if (!node) return;
    resizePatchRef.current = null;
    dragRef.current = {
      kind: "resize",
      path: selectedPath,
      pointerId: event.pointerId,
      capture: beginRichResizeCapture(node, handle, event.clientX, event.clientY, scale),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || textEditPath) return;
    event.stopPropagation();
    const next = applyRichResizeDrag(drag.capture, event.clientX, event.clientY, scale);
    resizePatchRef.current = {
      width: `${Math.round(next.width)}px`,
      height: `${Math.round(next.height)}px`,
      boxSizing: "border-box",
    };
    onLayoutChangeRef.current?.(drag.path, resizePatchRef.current, { recordHistory: false });
    scheduleSyncSelectionChrome();
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    syncSelectionChrome();
    if (resizePatchRef.current) {
      onLayoutChangeRef.current?.(drag.path, resizePatchRef.current, { recordHistory: true });
      resizePatchRef.current = null;
    }
  };

  const handleDoubleClick = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (textEditPath) return;
    event.stopPropagation();
    const root = getRootElement();
    if (!root) return;

    const hit = getRichHitElementAtClientPoint(root, event.clientX, event.clientY);
    if (!hit) return;

    const textHost = hit.closest("[data-rich-text-path]");
    if (textHost) {
      const textPath = textHost.getAttribute("data-rich-text-path");
      const path =
        textPath === "" || textPath === null
          ? null
          : textPath.split(".").map((part) => Number.parseInt(part, 10));
      if (path && path.every(Number.isFinite)) {
        patchEditState({ selectedPath: path.slice(0, -1), textEditPath: path });
        onSelectRichTextRef.current?.(path);
        return;
      }
    }

    const index = hitTestRichFocusChildIndex(root, focusPath, event.clientX, event.clientY);
    if (index === null) return;
    const path = childPath(focusPath, index);
    const astNode = getRichAstNodeAtPath(element.react_layout, path);
    if (isRichContainerNode(astNode)) {
      patchEditState({
        focusPath: path,
        selectedPath: null,
        textEditPath: null,
      });
      return;
    }
    if (isRichElementNode(astNode)) {
      patchEditState({ selectedPath: path, textEditPath: null });
    }
  };

  const showSelectionChrome = Boolean(selectedPath && !textEditPath);

  return (
    <div
      ref={containerRef}
      className={`relative h-full min-h-0 w-full overflow-visible ${className}`}
      style={style}
    >
      <div
        className="absolute left-0 top-0 overflow-hidden"
        style={{
          width: widthLogical,
          height: heightLogical,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        <RichRenderer
          reactLayout={element.react_layout}
          rootRef={rootRef}
          annotateNodePaths
          activeTextEditPath={textEditPath}
          selectedTextPath={textEditPath ?? undefined}
          onTextChange={(path, text) => onTextChangeRef.current?.(path, text)}
          onTextSelect={(path) => onSelectRichTextRef.current?.(path)}
          onTextCommit={() => patchEditState({ textEditPath: null })}
          containerStyle={{
            width: widthLogical,
            height: heightLogical,
            overflow: "hidden",
            boxSizing: "border-box",
          }}
        />
      </div>
      <div
        ref={overlayRef}
        className="absolute inset-0 z-10 cursor-default"
        data-rich-edit-overlay="true"
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
        data-rich-edit-chrome="true"
        style={{ display: "none" }}
      >
        {showSelectionChrome
          ? SVG_RESIZE_HANDLES.map((handle) => (
              <div
                key={handle}
                className="pointer-events-auto absolute z-30 h-3 w-3 rounded-sm border border-white bg-blue-500 shadow"
                style={{
                  left: handle.includes("w")
                    ? -6
                    : handle.includes("e")
                      ? "calc(100% - 6px)"
                      : "calc(50% - 6px)",
                  top: handle.includes("n")
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
          {t("coursewareEditor.stage.richEditHint")}
        </CoursewareInternalEditHint>
      )}
      {textEditPath ? (
        <div
          className="pointer-events-none absolute inset-0 z-[15]"
          onPointerDown={(event) => event.stopPropagation()}
        />
      ) : null}
      <EditorOverlapPickerMenu
        anchor={overlapMenu ? { x: overlapMenu.x, y: overlapMenu.y } : null}
        targets={overlapMenu?.targets ?? []}
        activeId={selectedPath ? pathKey(selectedPath) : null}
        themeMode={readActiveEditorThemeMode()}
        onClose={() => setOverlapMenu(null)}
        onPick={(id) => {
          const path = id === "" ? [] : id.split(".").map((part) => Number.parseInt(part, 10));
          if (!path.every(Number.isFinite)) return;
          patchEditState({ selectedPath: path, textEditPath: null });
          setOverlapMenu(null);
        }}
      />
    </div>
  );
}

export function defaultRichEditState(): CoursewareRichEditState {
  return { focusPath: [], selectedPath: null, textEditPath: null };
}

export function richEditStateKey(state: CoursewareRichEditState): string {
  return `${pathKey(state.focusPath)}|${state.selectedPath ? pathKey(state.selectedPath) : ""}|${state.textEditPath ? pathKey(state.textEditPath) : ""}`;
}
