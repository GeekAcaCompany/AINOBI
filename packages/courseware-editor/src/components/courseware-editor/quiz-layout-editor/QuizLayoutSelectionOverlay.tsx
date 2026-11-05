// SPDX-License-Identifier: AGPL-3.0-only
import type { PointerEvent as ReactPointerEvent } from "react";

export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export interface SelectionBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

const HANDLES: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
};

const handleOffset = (handle: ResizeHandle, size: number): React.CSSProperties => {
  const half = size / 2;
  const base: React.CSSProperties = {
    width: size,
    height: size,
    position: "absolute",
  };
  switch (handle) {
    case "nw":
      return { ...base, left: -half, top: -half, cursor: HANDLE_CURSORS.nw };
    case "n":
      return { ...base, left: "50%", top: -half, marginLeft: -half, cursor: HANDLE_CURSORS.n };
    case "ne":
      return { ...base, right: -half, top: -half, cursor: HANDLE_CURSORS.ne };
    case "e":
      return { ...base, right: -half, top: "50%", marginTop: -half, cursor: HANDLE_CURSORS.e };
    case "se":
      return { ...base, right: -half, bottom: -half, cursor: HANDLE_CURSORS.se };
    case "s":
      return { ...base, left: "50%", bottom: -half, marginLeft: -half, cursor: HANDLE_CURSORS.s };
    case "sw":
      return { ...base, left: -half, bottom: -half, cursor: HANDLE_CURSORS.sw };
    case "w":
      return { ...base, left: -half, top: "50%", marginTop: -half, cursor: HANDLE_CURSORS.w };
  }
};

export interface QuizLayoutSelectionOverlayProps {
  box: SelectionBox | null;
  previewBox?: SelectionBox | null;
  onResizeStart?: (handle: ResizeHandle, event: ReactPointerEvent) => void;
}

export function QuizLayoutSelectionOverlay({
  box,
  previewBox,
  onResizeStart,
}: QuizLayoutSelectionOverlayProps) {
  const display = previewBox ?? box;
  if (!display) return null;

  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: display.left,
        top: display.top,
        width: display.width,
        height: display.height,
      }}
    >
      <div className="quiz-layout-selection-ring absolute inset-0 rounded-sm" />
      {onResizeStart
        ? HANDLES.map((handle) => (
            <div
              key={handle}
              role="presentation"
              className="quiz-layout-resize-handle pointer-events-auto rounded-sm"
              style={handleOffset(handle, 8)}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onResizeStart(handle, e);
              }}
            />
          ))
        : null}
    </div>
  );
}
