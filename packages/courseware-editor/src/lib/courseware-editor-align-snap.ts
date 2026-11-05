// SPDX-License-Identifier: AGPL-3.0-only
/** Alignment snapping while dragging canvas elements (Figma-style guides) */

export type EditorAlignSnapBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
};

/** Snap target sources: canvas edges / canvas center axes / other elements' edges or centers */
export type EditorAlignSnapSource = "slide-edge" | "slide-center" | "peer";

export type EditorAlignSnapGuide = {
  axis: "x" | "y";
  /** Slide logical coordinates (px) */
  position: number;
  source: EditorAlignSnapSource;
};

export type EditorAlignSnapTarget = {
  position: number;
  source: EditorAlignSnapSource;
};

export type EditorAlignSnapLiveTransform = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

export type EditorResizeHandle = "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";

/** The usual snap threshold between elements / to the canvas center axes (logical pixels) */
export const EDITOR_ALIGN_SNAP_THRESHOLD_PX = 6;
/** Snap threshold of the canvas's four outer edges; somewhat larger so "sticking to the edge" triggers more easily */
export const EDITOR_ALIGN_SNAP_SLIDE_EDGE_THRESHOLD_PX = 12;

export function boxFromLiveTransform(t: {
  x: number;
  y: number;
  width: number;
  height: number;
}): EditorAlignSnapBox {
  return {
    left: t.x,
    top: t.y,
    right: t.x + t.width,
    bottom: t.y + t.height,
    centerX: t.x + t.width / 2,
    centerY: t.y + t.height / 2,
  };
}

export function collectAlignSnapTargetLines(
  slideWidth: number,
  slideHeight: number,
  peerBoxes: readonly EditorAlignSnapBox[],
): { x: EditorAlignSnapTarget[]; y: EditorAlignSnapTarget[] } {
  const xByPos = new Map<number, EditorAlignSnapTarget>();
  const yByPos = new Map<number, EditorAlignSnapTarget>();

  const upsert = (
    map: Map<number, EditorAlignSnapTarget>,
    target: EditorAlignSnapTarget,
  ): void => {
    const existing = map.get(target.position);
    // At the same position the priority is: slide-edge > slide-center > peer
    if (!existing || sourcePriority(target.source) > sourcePriority(existing.source)) {
      map.set(target.position, target);
    }
  };

  upsert(xByPos, { position: 0, source: "slide-edge" });
  upsert(xByPos, { position: slideWidth, source: "slide-edge" });
  upsert(xByPos, { position: slideWidth / 2, source: "slide-center" });
  upsert(yByPos, { position: 0, source: "slide-edge" });
  upsert(yByPos, { position: slideHeight, source: "slide-edge" });
  upsert(yByPos, { position: slideHeight / 2, source: "slide-center" });

  for (const box of peerBoxes) {
    upsert(xByPos, { position: box.left, source: "peer" });
    upsert(xByPos, { position: box.centerX, source: "peer" });
    upsert(xByPos, { position: box.right, source: "peer" });
    upsert(yByPos, { position: box.top, source: "peer" });
    upsert(yByPos, { position: box.centerY, source: "peer" });
    upsert(yByPos, { position: box.bottom, source: "peer" });
  }

  return { x: [...xByPos.values()], y: [...yByPos.values()] };
}

function sourcePriority(source: EditorAlignSnapSource): number {
  switch (source) {
    case "slide-edge":
      return 3;
    case "slide-center":
      return 2;
    case "peer":
      return 1;
  }
}

function thresholdForSource(source: EditorAlignSnapSource, baseThreshold: number): number {
  if (source === "slide-edge") return EDITOR_ALIGN_SNAP_SLIDE_EDGE_THRESHOLD_PX;
  return baseThreshold;
}

type AxisSnapResult = {
  offset: number;
  target: EditorAlignSnapTarget | null;
};

function snapAxis(
  anchors: readonly number[],
  targets: readonly EditorAlignSnapTarget[],
  baseThreshold: number,
): AxisSnapResult {
  // When comparing distances the canvas edge's actual distance is scaled down by a factor, so it wins within the overlap zone
  // instead of being beaten by a closer peer edge.
  let bestScore = Number.POSITIVE_INFINITY;
  let bestOffset = 0;
  let bestTarget: EditorAlignSnapTarget | null = null;

  for (const anchor of anchors) {
    for (const target of targets) {
      const dist = Math.abs(anchor - target.position);
      const threshold = thresholdForSource(target.source, baseThreshold);
      if (dist > threshold) continue;
      const weight = target.source === "slide-edge" ? 0.5 : 1;
      const score = dist * weight;
      if (score < bestScore) {
        bestScore = score;
        bestOffset = target.position - anchor;
        bestTarget = target;
      }
    }
  }

  return { offset: bestOffset, target: bestTarget };
}

/** Snap a moving element to guides and return the guides to draw */
export function snapLiveTransformMove(
  transform: EditorAlignSnapLiveTransform,
  xTargets: readonly EditorAlignSnapTarget[],
  yTargets: readonly EditorAlignSnapTarget[],
  threshold = EDITOR_ALIGN_SNAP_THRESHOLD_PX,
): { transform: EditorAlignSnapLiveTransform; guides: EditorAlignSnapGuide[] } {
  const box = boxFromLiveTransform(transform);
  const xSnap = snapAxis([box.left, box.centerX, box.right], xTargets, threshold);
  const ySnap = snapAxis([box.top, box.centerY, box.bottom], yTargets, threshold);

  const guides: EditorAlignSnapGuide[] = [];
  if (xSnap.target) {
    guides.push({ axis: "x", position: xSnap.target.position, source: xSnap.target.source });
  }
  if (ySnap.target) {
    guides.push({ axis: "y", position: ySnap.target.position, source: ySnap.target.source });
  }

  return {
    transform: {
      ...transform,
      x: transform.x + xSnap.offset,
      y: transform.y + ySnap.offset,
    },
    guides,
  };
}

/** Snap the edges of a resizing element to guides (only the edges being dragged) */
export function snapLiveTransformResize(
  transform: EditorAlignSnapLiveTransform,
  handle: EditorResizeHandle,
  xTargets: readonly EditorAlignSnapTarget[],
  yTargets: readonly EditorAlignSnapTarget[],
  threshold = EDITOR_ALIGN_SNAP_THRESHOLD_PX,
  minSize = 20,
): { transform: EditorAlignSnapLiveTransform; guides: EditorAlignSnapGuide[] } {
  const box = boxFromLiveTransform(transform);
  const guides: EditorAlignSnapGuide[] = [];
  let x = transform.x;
  let y = transform.y;
  let width = transform.width;
  let height = transform.height;

  if (handle.includes("e")) {
    const xSnap = snapAxis([box.right], xTargets, threshold);
    if (xSnap.target) {
      guides.push({ axis: "x", position: xSnap.target.position, source: xSnap.target.source });
      width = Math.max(minSize, transform.width + xSnap.offset);
    }
  } else if (handle.includes("w")) {
    const xSnap = snapAxis([box.left], xTargets, threshold);
    if (xSnap.target) {
      guides.push({ axis: "x", position: xSnap.target.position, source: xSnap.target.source });
      const proposedWidth = transform.width - xSnap.offset;
      if (proposedWidth < minSize) {
        width = minSize;
        x = transform.x + transform.width - minSize;
      } else {
        x = transform.x + xSnap.offset;
        width = proposedWidth;
      }
    }
  }

  if (handle.includes("s")) {
    const ySnap = snapAxis([box.bottom], yTargets, threshold);
    if (ySnap.target) {
      guides.push({ axis: "y", position: ySnap.target.position, source: ySnap.target.source });
      height = Math.max(minSize, transform.height + ySnap.offset);
    }
  } else if (handle.includes("n")) {
    const ySnap = snapAxis([box.top], yTargets, threshold);
    if (ySnap.target) {
      guides.push({ axis: "y", position: ySnap.target.position, source: ySnap.target.source });
      const proposedHeight = transform.height - ySnap.offset;
      if (proposedHeight < minSize) {
        height = minSize;
        y = transform.y + transform.height - minSize;
      } else {
        y = transform.y + ySnap.offset;
        height = proposedHeight;
      }
    }
  }

  return {
    transform: { ...transform, x, y, width, height },
    guides,
  };
}

/**
 * Grouping rule: under the single-element quiz model, each quiz element is already a single positionable canvas box,
 * with no more "wrapper + members" linkage; selecting moves it, and multi-select moves the selected set.
 */
export function expandEditorMoveGroupIds(
  selectedElementIds: readonly string[],
  _slideChildren: readonly { element_id: string; element_type: string }[],
): Set<string> {
  return new Set(selectedElementIds);
}
