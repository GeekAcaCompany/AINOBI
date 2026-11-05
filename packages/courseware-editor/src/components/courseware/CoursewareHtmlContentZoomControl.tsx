// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState, type ReactElement, type PointerEvent } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import {
  HTML_CONTENT_ZOOM_DEFAULT,
  HTML_CONTENT_ZOOM_MAX,
  HTML_CONTENT_ZOOM_MIN,
  HTML_CONTENT_ZOOM_STEP,
  resolveHtmlContentZoom,
} from "@ainobi/courseware-player/components/courseware/CoursewareHtmlStageEmbed";

export type CoursewareHtmlContentZoomControlProps = {
  value?: number;
  /** Painted element box width on the canvas (CSS px); sizes the slider track. */
  hostWidthPx: number;
  scale: number;
  label: string;
  onChange: (zoom: number, options?: { recordHistory?: boolean }) => void;
};

export function CoursewareHtmlContentZoomControl({
  value,
  hostWidthPx,
  scale,
  label,
  onChange,
}: CoursewareHtmlContentZoomControlProps): ReactElement {
  const resolved = resolveHtmlContentZoom(value);
  const [draft, setDraft] = useState(resolved);
  const draggingRef = useRef(false);

  useEffect(() => {
    if (!draggingRef.current) {
      setDraft(resolved);
    }
  }, [resolved]);

  const commitDraft = (next: number, recordHistory: boolean): void => {
    const clamped = resolveHtmlContentZoom(next);
    setDraft(clamped);
    onChange(clamped, { recordHistory });
  };

  const onSliderInput = (nextRaw: number): void => {
    const next = resolveHtmlContentZoom(nextRaw);
    setDraft(next);
    onChange(next, { recordHistory: false });
  };

  const onPointerDown = (event: PointerEvent<HTMLInputElement>): void => {
    event.stopPropagation();
    draggingRef.current = true;
  };

  const onPointerUp = (event: PointerEvent<HTMLInputElement>): void => {
    event.stopPropagation();
    draggingRef.current = false;
    commitDraft(Number(event.currentTarget.value), true);
  };

  const nudge = (delta: number): void => {
    commitDraft(draft + delta, true);
  };

  const barWidth = Math.max(280, Math.min(Math.round(hostWidthPx * 0.96), 560));
  const fontSize = Math.max(11, 12 * scale);
  const iconSize = Math.max(14, 16 * scale);
  const buttonSize = Math.max(24, 26 * scale);
  const padY = Math.max(6, 7 * scale);
  const padX = Math.max(10, 12 * scale);

  return (
    <div
      className="absolute z-30 flex items-center rounded-lg border border-slate-300/90 bg-white/95 shadow-md backdrop-blur-sm dark:border-slate-600 dark:bg-slate-900/95"
      style={{
        left: "50%",
        top: -84 * scale,
        transform: "translateX(-50%)",
        width: barWidth,
        padding: `${padY}px ${padX}px`,
        gap: 10 * scale,
        pointerEvents: "auto",
      }}
      title={label}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="flex shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        style={{ width: buttonSize, height: buttonSize }}
        aria-label={`${label} −`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          nudge(-HTML_CONTENT_ZOOM_STEP);
        }}
      >
        <ZoomOut style={{ width: iconSize, height: iconSize }} aria-hidden />
      </button>
      <input
        type="range"
        min={HTML_CONTENT_ZOOM_MIN}
        max={HTML_CONTENT_ZOOM_MAX}
        step={HTML_CONTENT_ZOOM_STEP}
        value={draft}
        aria-label={label}
        className="h-2 min-w-0 flex-1 cursor-pointer accent-blue-500"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onChange={(event) => onSliderInput(Number(event.currentTarget.value))}
      />
      <button
        type="button"
        className="flex shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        style={{ width: buttonSize, height: buttonSize }}
        aria-label={`${label} +`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          nudge(HTML_CONTENT_ZOOM_STEP);
        }}
      >
        <ZoomIn style={{ width: iconSize, height: iconSize }} aria-hidden />
      </button>
      <span
        className="shrink-0 tabular-nums text-slate-600 dark:text-slate-300"
        style={{ fontSize, minWidth: 40 * scale }}
      >
        {Math.round((draft || HTML_CONTENT_ZOOM_DEFAULT) * 100)}%
      </span>
    </div>
  );
}
