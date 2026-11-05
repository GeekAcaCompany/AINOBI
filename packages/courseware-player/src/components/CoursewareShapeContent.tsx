// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties, ReactElement } from "react";
import type { ArrowElement, LineElement, ShapeElement } from "@ainobi/courseware-core/elements.ts";

const isTransparentColor = (value: string): boolean => {
  const trimmed = value.trim().toLowerCase();
  return trimmed === "" || trimmed === "transparent" || trimmed === "none";
};

const renderLine = (strokeWidth: number, strokeColor: string): ReactElement => (
  <div className="flex h-full w-full items-center" style={{ pointerEvents: "none" }}>
    <div
      style={{
        width: "100%",
        height: strokeWidth,
        backgroundColor: strokeColor,
        borderRadius: strokeWidth / 2,
      }}
    />
  </div>
);

const renderArrow = (
  element: ArrowElement,
  strokeWidth: number,
  strokeColor: string,
  scale: number,
): ReactElement => {
  const width = Math.max(1, element.size.width * scale);
  const height = Math.max(1, element.size.height * scale);
  const headLen = Math.min(Math.max(strokeWidth * 3, height * 0.78), width * 0.42);
  const cy = height / 2;
  const shaftEnd = Math.max(0, width - headLen);
  const headHalf = headLen / 2;

  return (
    <svg
      className="h-full w-full overflow-visible"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
      style={{ pointerEvents: "none" }}
    >
      <line
        x1={0}
        y1={cy}
        x2={shaftEnd}
        y2={cy}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <polygon
        points={`${shaftEnd},${cy - headHalf} ${width},${cy} ${shaftEnd},${cy + headHalf}`}
        fill={strokeColor}
        stroke="none"
      />
    </svg>
  );
};

export function CoursewareShapeContent({
  element,
  scale,
}: {
  element: ShapeElement;
  scale: number;
}): ReactElement {
  if (element.element_type === "line") {
    const strokeWidth = Math.max(1, (element as LineElement).stroke_width * scale);
    const strokeColor = isTransparentColor(element.color) ? undefined : element.color;
    if (!strokeColor) return <div className="h-full w-full" />;
    return renderLine(strokeWidth, strokeColor);
  }

  if (element.element_type === "arrow") {
    const strokeWidth = Math.max(1, element.stroke_width * scale);
    const strokeColor = isTransparentColor(element.color) ? undefined : element.color;
    if (!strokeColor) return <div className="h-full w-full" />;
    return renderArrow(element, strokeWidth, strokeColor, scale);
  }

  const fill = isTransparentColor(element.color) ? undefined : element.color;
  const stroke = isTransparentColor(element.stroke_color) ? undefined : element.stroke_color;
  const strokeWidth = element.stroke_width * scale;
  const style: CSSProperties = {
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    backgroundColor: fill,
    border: strokeWidth > 0 && stroke ? `${strokeWidth}px solid ${stroke}` : undefined,
    borderRadius:
      element.element_type === "ellipse"
        ? "50%"
        : Math.max(0, element.border_radius_px) * scale,
  };

  return <div className="h-full w-full" style={style} />;
}
