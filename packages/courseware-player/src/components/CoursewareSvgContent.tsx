// SPDX-License-Identifier: AGPL-3.0-only
import type { SvgElement } from "../lib/courseware/index.ts";
import { clearSvgEditHighlights } from "../lib/courseware/svg-edit.ts";
import type { CSSProperties } from "react";
import { useLayoutEffect, useRef } from "react";

function isInlineSvgMarkup(source: string): boolean {
  const trimmed = source.trimStart();
  return trimmed.startsWith("<svg") || trimmed.startsWith("<?xml");
}

/**
 * Injects inline SVG markup imperatively so React reconciliation does not rewrite
 * `innerHTML` on every parent re-render (e.g. editor/preview playback ticking
 * `currentTime` each rAF), which otherwise restarts SMIL / in-SVG CSS animations.
 */
function CoursewareInlineSvgHost({
  className,
  markup,
}: {
  className: string;
  markup: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appliedRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    if (appliedRef.current === markup) return;
    appliedRef.current = markup;
    el.innerHTML = markup;
    const svg = el.querySelector("svg");
    if (svg instanceof SVGSVGElement) clearSvgEditHighlights(svg);
  }, [markup]);

  return <div ref={hostRef} className={className} />;
}

/**
 * Renders a courseware `svg` element. `source` may be a URL or raw SVG markup.
 */
export function CoursewareSvgContent({
  element,
  className = "h-full w-full",
  style,
}: {
  element: SvgElement;
  className?: string;
  style?: CSSProperties;
}) {
  const source = element.source.trim();
  const objectFit = element.preserve_aspect_ratio ? "contain" : "fill";

  if (!source) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center rounded-md border border-dashed border-slate-600 bg-slate-900/70 px-3 text-center text-slate-300">
        <span className="text-xs">未设置 SVG 内容</span>
      </div>
    );
  }

  if (isInlineSvgMarkup(source)) {
    const inlineSvgClass = element.preserve_aspect_ratio
      ? "[&_svg]:max-h-full [&_svg]:max-w-full [&_svg]:h-auto [&_svg]:w-auto"
      : "[&_svg]:h-full [&_svg]:w-full";
    return (
      <div
        className={`flex items-center justify-center overflow-hidden ${className}`}
        style={style}
      >
        <CoursewareInlineSvgHost
          className={`flex h-full w-full items-center justify-center ${inlineSvgClass}`}
          markup={source}
        />
      </div>
    );
  }

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
