// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  clampManualMarkRect,
  type CoursewareManualMarkPending,
  type CoursewareManualMarkRect,
  type CoursewareManualMarkRegion,
} from "@ainobi/courseware-player/lib/courseware/ai-manual-marks";
import { useI18nNew } from "@ainobi/courseware-player/hooks/useI18nNew";

const MIN_MARK_LOGICAL = 8;

type Props = {
  scale: number;
  regions: readonly CoursewareManualMarkRegion[];
  pendingMark: CoursewareManualMarkPending | null;
  onPendingMarkCreate: (pending: CoursewareManualMarkPending) => void;
};

function normalizeAxisRect(x0: number, y0: number, x1: number, y1: number) {
  return {
    left: Math.min(x0, x1),
    top: Math.min(y0, y1),
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
  };
}

function createMarkId(): string {
  return `mark_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const MARK_LABEL_CLASS =
  "pointer-events-none absolute z-[1] max-w-[min(240px,40vw)] -translate-y-full whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold text-white shadow";

function MarkRegionView({
  left,
  top,
  width,
  height,
  label,
  borderClass,
  fillClass,
  labelClass,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
  label: string;
  borderClass: string;
  fillClass: string;
  labelClass: string;
}) {
  return (
    <>
      <div
        className={`pointer-events-none absolute border-2 ${borderClass} ${fillClass}`}
        style={{ left, top, width, height }}
      />
      <span className={`${MARK_LABEL_CLASS} ${labelClass}`} style={{ left, top }}>
        {label}
      </span>
    </>
  );
}

export function CoursewareStageManualMarkOverlay({
  scale,
  regions,
  pendingMark,
  onPendingMarkCreate,
}: Props) {
  const { t } = useI18nNew();
  const [draftLogical, setDraftLogical] = useState<CoursewareManualMarkRect | null>(null);
  const dragRef = useRef<{ pointerId: number; x0: number; y0: number } | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const clientToLogical = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const el = stageRef.current;
      if (!el || scale <= 0) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      return {
        x: (clientX - rect.left) / scale,
        y: (clientY - rect.top) / scale,
      };
    },
    [scale],
  );

  const canDraw = !draftLogical && !pendingMark;

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!canDraw || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const pt = clientToLogical(e.clientX, e.clientY);
    dragRef.current = { pointerId: e.pointerId, x0: pt.x, y0: pt.y };
    setDraftLogical({ x: pt.x, y: pt.y, width: 0, height: 0 });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.stopPropagation();
    const pt = clientToLogical(e.clientX, e.clientY);
    const box = normalizeAxisRect(drag.x0, drag.y0, pt.x, pt.y);
    const rect = clampManualMarkRect(box.left, box.top, box.left + box.width, box.top + box.height);
    if (rect) setDraftLogical(rect);
  };

  const finishDraft = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    e.stopPropagation();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    setDraftLogical(null);
    const pt = clientToLogical(e.clientX, e.clientY);
    const box = normalizeAxisRect(drag.x0, drag.y0, pt.x, pt.y);
    const rect = clampManualMarkRect(box.left, box.top, box.left + box.width, box.top + box.height);
    if (!rect || rect.width < MIN_MARK_LOGICAL || rect.height < MIN_MARK_LOGICAL) return;
    onPendingMarkCreate({
      markId: createMarkId(),
      position: { x: rect.x, y: rect.y },
      size: { width: rect.width, height: rect.height },
    });
  };

  return (
    <div
      ref={stageRef}
      className={`pointer-events-auto absolute inset-0 z-[60] touch-none ${canDraw ? "cursor-crosshair" : "cursor-default"}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDraft}
      onPointerCancel={finishDraft}
    >
      {regions.map((m) => {
        const left = m.position.x * scale;
        const top = m.position.y * scale;
        const width = m.size.width * scale;
        const height = m.size.height * scale;
        return (
          <MarkRegionView
            key={m.markId}
            left={left}
            top={top}
            width={width}
            height={height}
            label={t("coursewareEditor.manualMark.overlayLabel", { index: m.index })}
            borderClass="border-rose-500"
            fillClass="bg-rose-500/25"
            labelClass="bg-rose-600"
          />
        );
      })}

      {pendingMark ? (
        <MarkRegionView
          left={pendingMark.position.x * scale}
          top={pendingMark.position.y * scale}
          width={pendingMark.size.width * scale}
          height={pendingMark.size.height * scale}
          label={t("coursewareEditor.manualMark.overlayPending", {
            index: regions.length + 1,
          })}
          borderClass="border-dashed border-rose-400"
          fillClass="bg-rose-500/20"
          labelClass="bg-rose-500/90 font-medium"
        />
      ) : null}

      {draftLogical ? (
        <div
          className="pointer-events-none absolute border-2 border-dashed border-rose-400 bg-rose-500/15"
          style={{
            left: draftLogical.x * scale,
            top: draftLogical.y * scale,
            width: draftLogical.width * scale,
            height: draftLogical.height * scale,
          }}
        />
      ) : null}
    </div>
  );
}
