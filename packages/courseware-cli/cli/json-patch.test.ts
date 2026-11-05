// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { createJsonPatch } from "./json-patch.ts";
import { deserializeScene, serializeScene } from "@ainobi/courseware-core";

test("createJsonPatch does not emit add operations with undefined values", () => {
  const ops = createJsonPatch({}, { background_image_fit: undefined });
  assert.deepEqual(ops, []);
});

test("createJsonPatch adds defaulted slide fields only when values are present after normalization", () => {
  const editorSlide = {
    element_type: "slide",
    element_id: "el_slide_test",
    name: "封面",
    fps: 30,
    position: { x: 0, y: 0 },
    size: { width: 1920, height: 1080 },
    timeline: { start_at: 0, end_at: 5000 },
    style: { opacity: 1, rotation_deg: 0, z_index: 0 },
    enter_effect: "none",
    exit_effect: "none",
    animations: [],
    keyframes: [],
    event_bindings: [],
    action_mappings: {},
    event_scripts: {},
    preset_script: "",
    metadata: {},
    background_color: "#f0f0ec",
    children_elements: [],
  };
  const scene = deserializeScene({
    scene_id: "sc_test",
    name: "test",
    controller: {
      play: true,
      next: true,
      back: true,
      seekBar: true,
      time: true,
      slideNumber: true,
      volume: true,
      fullScreen: true,
      brand: true,
      playbackRate: true,
    },
    transitions: [],
    preset_script: "",
    metadata: {},
    vtuber_elements: [],
    audio_elements: [],
    slide_elements: [editorSlide],
  });
  const before = { slide_elements: [editorSlide] };
  const after = serializeScene(scene) as { slide_elements: unknown[] };
  const ops = createJsonPatch(before, after);
  for (const op of ops) {
    if (op.op === "add" || op.op === "replace") {
      assert.ok("value" in op);
      assert.notEqual(op.value, undefined);
    }
  }
  const fitAdd = ops.find(
    (op) => op.op === "add" && op.path === "/slide_elements/0/background_image_fit",
  );
  if (fitAdd && fitAdd.op === "add") {
    assert.equal(fitAdd.value, "cover");
  }
});

test("createJsonPatch emits remove when deleting the first child element (not a replace chain)", () => {
  const a = { element_id: "el_a", element_type: "text", name: "a" };
  const b = { element_id: "el_b", element_type: "text", name: "b" };
  const c = { element_id: "el_c", element_type: "text", name: "c" };
  const ops = createJsonPatch(
    { children_elements: [a, b, c] },
    { children_elements: [b, c] },
  );
  assert.deepEqual(ops, [{ op: "remove", path: "/children_elements/0", old_value: a }]);
});

test("createJsonPatch emits remove for bulk front deletions without duplicating surviving ids", () => {
  const mk = (id: string) => ({ element_id: id, element_type: "text", name: id });
  const before = [mk("el_1"), mk("el_2"), mk("el_3"), mk("el_4")];
  const after = [mk("el_3"), mk("el_4")];
  const ops = createJsonPatch({ children_elements: before }, { children_elements: after });
  assert.deepEqual(
    ops.filter((op) => op.op === "remove").map((op) => op.path),
    ["/children_elements/1", "/children_elements/0"],
  );
  assert.equal(
    ops.some((op) => op.op === "replace" && op.path === "/children_elements/0"),
    false,
  );
});

test("createJsonPatch emits add at target index when inserting a new element", () => {
  const a = { element_id: "el_a", element_type: "text" };
  const b = { element_id: "el_b", element_type: "text" };
  const c = { element_id: "el_c", element_type: "text" };
  const ops = createJsonPatch(
    { children_elements: [a, b] },
    { children_elements: [a, c, b] },
  );
  assert.deepEqual(ops, [{ op: "add", path: "/children_elements/1", value: c }]);
});

test("createJsonPatch adds highlight_segments when before value is undefined (live preview)", () => {
  const rectangle = {
    element_id: "el_shape_1",
    element_type: "rectangle",
    animations: [],
    keyframes: [],
    highlight_segments: undefined,
  };
  const highlight = {
    highlight_id: "hl_1",
    start_at: 0,
    end_at: 5000,
    padding_px: 12,
    border_radius_px: 24,
    overlay_color: "#000000",
    overlay_opacity: 0.62,
  };
  const ops = createJsonPatch(rectangle, { ...rectangle, highlight_segments: [highlight] });
  assert.deepEqual(ops, [{ op: "add", path: "/highlight_segments", value: [highlight] }]);
});

test("createJsonPatch appends multiple new elements in ascending index order (narration insert)", () => {
  const mk = (id: string, type: string) => ({ element_id: id, element_type: type });
  const before = Array.from({ length: 9 }, (_, i) => mk(`el_${i}`, "text"));
  const vtuber = mk("el_vtuber_x", "vtuber");
  const narration = mk("el_narration_y", "narration");
  const after = [...before, vtuber, narration];
  const ops = createJsonPatch({ children_elements: before }, { children_elements: after });
  const adds = ops.filter((op) => op.op === "add");
  assert.equal(adds.length, 2);
  assert.deepEqual(
    adds.map((op) => op.path),
    ["/children_elements/9", "/children_elements/10"],
  );
});
