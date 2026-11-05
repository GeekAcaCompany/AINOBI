// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { Scene } from "@ainobi/courseware-core/scene.ts";
import type { SlideFlowPausePoint } from "@ainobi/courseware-core/slide-flow-pause.ts";
import { FLOW_PAUSE_DRAG_STEP_MS } from "@ainobi/courseware-core/slide-flow-pause.ts";

const FLOW_PAUSE_DRAG_THRESHOLD_PX = 4;

const snapFlowPauseMs = (ms: number, durationMs: number): number => {
  const stepped = Math.round(ms / FLOW_PAUSE_DRAG_STEP_MS) * FLOW_PAUSE_DRAG_STEP_MS;
  return Math.min(Math.max(0, stepped), Math.max(0, durationMs));
};

type FlowPauseTimelineMarkersProps = {
  points: SlideFlowPausePoint[];
  durationMs: number;
  layoutDurationMs: number;
  /** Convert horizontal pointer position to slide-local ms. */
  clientXToLocalMs: (clientX: number) => number;
  onUpdatePoint: (pauseId: string, atMs: number) => void;
  onCaptureHistorySnapshot?: () => Scene;
  onCommitHistorySnapshot?: (snapshot: Scene) => void;
  selectedPauseId?: string | null;
  onSelectPause?: (pauseId: string | null) => void;
  onDeletePause?: (pauseId: string) => void;
  /** Ruler-only handles (full timeline). */
  variant: "ruler" | "tracks" | "compact";
  dragLabel: string;
};

export function FlowPauseTimelineMarkers({
  points,
  durationMs,
  layoutDurationMs,
  clientXToLocalMs,
  onUpdatePoint,
  onCaptureHistorySnapshot,
  onCommitHistorySnapshot,
  selectedPauseId = null,
  onSelectPause,
  onDeletePause,
  variant,
  dragLabel,
}: FlowPauseTimelineMarkersProps) {
  const dragRef = useRef<{
    pauseId: string;
    historySnapshot: Scene | null;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  const beginDrag = useCallback(
    (pauseId: string, event: ReactPointerEvent<HTMLElement>): void => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      const historySnapshot = onCaptureHistorySnapshot?.() ?? null;
      dragRef.current = {
        pauseId,
        historySnapshot,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [onCaptureHistorySnapshot],
  );

  const moveDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) >= FLOW_PAUSE_DRAG_THRESHOLD_PX) {
        drag.moved = true;
      }
      if (!drag.moved) return;
      const atMs = snapFlowPauseMs(clientXToLocalMs(event.clientX), durationMs);
      onUpdatePoint(drag.pauseId, atMs);
    },
    [clientXToLocalMs, durationMs, onUpdatePoint],
  );

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      if (!drag.moved) {
        onSelectPause?.(drag.pauseId);
      } else if (drag.historySnapshot !== null && onCommitHistorySnapshot) {
        onCommitHistorySnapshot(drag.historySnapshot);
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [onCommitHistorySnapshot, onSelectPause],
  );

  const handleContextDelete = useCallback(
    (pauseId: string, event: React.MouseEvent<HTMLElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      onDeletePause?.(pauseId);
    },
    [onDeletePause],
  );

  if (points.length === 0) return null;

  const denom = Math.max(1, layoutDurationMs);

  return (
    <>
      {points.map((point) => {
        const leftPct = (point.at_ms / denom) * 100;
        const isSelected = selectedPauseId === point.pause_id;
        if (variant === "tracks") {
          return (
            <div
              key={`flow-pause-track-${point.pause_id}`}
              className={`pointer-events-none absolute inset-y-0 z-24 w-0.5 ${
                isSelected
                  ? "bg-amber-500 dark:bg-amber-200"
                  : "bg-amber-400/95 dark:bg-amber-300/90"
              }`}
              style={{ left: `${leftPct}%`, marginLeft: -1 }}
            />
          );
        }
        const markerLineClass = isSelected
          ? "h-full w-1 shrink-0 rounded-full bg-amber-500 shadow-[0_0_0_2px_rgba(251,191,36,0.55)] dark:bg-amber-200"
          : "h-full w-0.5 shrink-0 rounded-full bg-amber-400 shadow-[0_0_0_1px_rgba(251,191,36,0.35)] transition group-hover/flow-pause:w-1 dark:bg-amber-300";
        if (variant === "ruler") {
          return (
            <div
              key={`flow-pause-ruler-${point.pause_id}`}
              role="separator"
              aria-orientation="vertical"
              aria-label={dragLabel}
              aria-selected={isSelected}
              title={dragLabel}
              className="group/flow-pause absolute top-0 z-35 flex h-full w-4 -translate-x-1/2 cursor-ew-resize items-stretch justify-center"
              style={{ left: `${leftPct}%` }}
              onPointerDown={(e) => beginDrag(point.pause_id, e)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onContextMenu={(e) => handleContextDelete(point.pause_id, e)}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={markerLineClass} />
            </div>
          );
        }
        return (
          <div
            key={`flow-pause-compact-${point.pause_id}`}
            role="separator"
            aria-orientation="vertical"
            aria-label={dragLabel}
            aria-selected={isSelected}
            title={dragLabel}
            className="absolute top-1/2 z-20 flex h-4 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center"
            style={{ left: `${leftPct}%` }}
            onPointerDown={(e) => beginDrag(point.pause_id, e)}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onContextMenu={(e) => handleContextDelete(point.pause_id, e)}
          >
            <div
              className={`rounded-full ${
                isSelected
                  ? "h-full w-1 bg-amber-500 dark:bg-amber-200"
                  : "h-full w-0.5 bg-amber-400 dark:bg-amber-300"
              }`}
            />
          </div>
        );
      })}
    </>
  );
}
