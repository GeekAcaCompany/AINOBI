// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  boxFromLiveTransform,
  collectAlignSnapTargetLines,
  expandEditorMoveGroupIds,
  snapLiveTransformMove,
  snapLiveTransformResize,
} from "./courseware-editor-align-snap.ts";

describe("snapLiveTransformMove", () => {
  it("snaps left edge to slide left", () => {
    const { x, y } = collectAlignSnapTargetLines(1920, 1080, []);
    const { transform, guides } = snapLiveTransformMove(
      { x: 3, y: 100, width: 80, height: 40, rotation: 0 },
      x,
      y,
      6,
    );
    expect(transform.x).toBe(0);
    expect(guides).toEqual([{ axis: "x", position: 0, source: "slide-edge" }]);
  });

  it("snaps right edge to slide right within widened slide-edge threshold", () => {
    const { x, y } = collectAlignSnapTargetLines(1920, 1080, []);
    const { transform, guides } = snapLiveTransformMove(
      { x: 1830, y: 100, width: 80, height: 40, rotation: 0 },
      x,
      y,
      6,
    );
    expect(transform.x).toBe(1840);
    expect(guides).toEqual([{ axis: "x", position: 1920, source: "slide-edge" }]);
  });

  it("snaps bottom edge to slide bottom", () => {
    const { x, y } = collectAlignSnapTargetLines(1920, 1080, []);
    const { transform, guides } = snapLiveTransformMove(
      { x: 100, y: 1030, width: 80, height: 40, rotation: 0 },
      x,
      y,
      6,
    );
    expect(transform.y).toBe(1040);
    expect(guides).toEqual([{ axis: "y", position: 1080, source: "slide-edge" }]);
  });

  it("snaps vertical center to peer center", () => {
    const peer = boxFromLiveTransform({ x: 400, y: 200, width: 100, height: 50 });
    const { x, y } = collectAlignSnapTargetLines(1920, 1080, [peer]);
    const moving = { x: 395, y: 210, width: 100, height: 50, rotation: 0 };
    const { transform, guides } = snapLiveTransformMove(moving, x, y, 6);
    expect(transform.x).toBe(400);
    expect(guides.some((g) => g.axis === "x" && (g.position === 400 || g.position === 450))).toBe(
      true,
    );
  });

  it("prefers slide edge over a comparable peer edge", () => {
    // Distance to the canvas left (0) = 5; distance to the peer left (11) = 6 — canvas edges weigh more, so it snaps to the canvas first
    const peer = boxFromLiveTransform({ x: 11, y: 200, width: 100, height: 50 });
    const { x, y } = collectAlignSnapTargetLines(1920, 1080, [peer]);
    const moving = { x: 5, y: 800, width: 80, height: 40, rotation: 0 };
    const { transform, guides } = snapLiveTransformMove(moving, x, y, 6);
    expect(transform.x).toBe(0);
    expect(guides[0]).toEqual({ axis: "x", position: 0, source: "slide-edge" });
  });
});

describe("snapLiveTransformResize", () => {
  it("snaps east handle right edge to slide right", () => {
    const { x, y } = collectAlignSnapTargetLines(1920, 1080, []);
    const { transform, guides } = snapLiveTransformResize(
      { x: 100, y: 100, width: 1810, height: 40, rotation: 0 },
      "e",
      x,
      y,
      6,
    );
    expect(transform.width).toBe(1820);
    expect(transform.x).toBe(100);
    expect(guides).toEqual([{ axis: "x", position: 1920, source: "slide-edge" }]);
  });

  it("snaps west handle left edge to peer left", () => {
    const peer = boxFromLiveTransform({ x: 400, y: 200, width: 100, height: 50 });
    const { x, y } = collectAlignSnapTargetLines(1920, 1080, [peer]);
    const { transform, guides } = snapLiveTransformResize(
      { x: 405, y: 210, width: 100, height: 50, rotation: 0 },
      "w",
      x,
      y,
      6,
    );
    expect(transform.x).toBe(400);
    expect(transform.width).toBe(105);
    expect(guides.some((g) => g.axis === "x" && g.position === 400)).toBe(true);
  });

  it("snaps south handle bottom edge to slide bottom", () => {
    const { x, y } = collectAlignSnapTargetLines(1920, 1080, []);
    const { transform, guides } = snapLiveTransformResize(
      { x: 100, y: 100, width: 80, height: 975, rotation: 0 },
      "s",
      x,
      y,
      6,
    );
    expect(transform.height).toBe(980);
    expect(transform.y).toBe(100);
    expect(guides).toEqual([{ axis: "y", position: 1080, source: "slide-edge" }]);
  });
});

describe("expandEditorMoveGroupIds", () => {
  it("returns just the selected ids in the single-element quiz model", () => {
    const ids = expandEditorMoveGroupIds(["q1"], [
      { element_id: "q1", element_type: "quiz" },
      { element_id: "t1", element_type: "text" },
    ]);
    expect([...ids].sort()).toEqual(["q1"]);
  });

  it("preserves a multi-select set verbatim (no wrapper expansion)", () => {
    const ids = expandEditorMoveGroupIds(["q1", "t1"], [
      { element_id: "q1", element_type: "quiz" },
      { element_id: "t1", element_type: "text" },
      { element_id: "i1", element_type: "image" },
    ]);
    expect([...ids].sort()).toEqual(["q1", "t1"]);
  });

  it("returns an empty set when nothing is selected", () => {
    const ids = expandEditorMoveGroupIds([], [
      { element_id: "q1", element_type: "quiz" },
    ]);
    expect([...ids]).toEqual([]);
  });
});
