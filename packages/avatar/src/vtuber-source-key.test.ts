// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { VtuberElement } from "@ainobi/courseware-core/elements.ts";
import { getVtuberSourceKey, resolveVtuberEditorSnapshot } from "./vtuber-source-key.ts";

const baseVtuber = (overrides: Partial<VtuberElement> = {}): VtuberElement =>
  ({
    element_type: "vtuber",
    element_id: "vt_1",
    model_id: "teacher_a",
    expression: "",
    motion: "",
    metadata: {},
    ...overrides,
  }) as VtuberElement;

describe("getVtuberSourceKey", () => {
  it("shares one key for the same model url on different element ids", () => {
    const url = "https://cdn.example.com/a.model3.json";
    const el = baseVtuber({ element_id: "vt_a", metadata: { model_url: url } });
    const el2 = baseVtuber({ element_id: "vt_b", metadata: { model_url: url } });
    expect(getVtuberSourceKey(el)).toBe(getVtuberSourceKey(el2));
  });

  it("uses default live2d path when metadata has no model url", () => {
    const el = baseVtuber({ model_id: "teacher_a", metadata: {} });
    expect(getVtuberSourceKey(el)).toBe("model:/models/geekaca-teacher/geekaca-teacher.model3.json");
  });
});

describe("resolveVtuberEditorSnapshot", () => {
  it("does not fall back to element-id snapshots after model url changes", () => {
    const oldUrl = "https://cdn.example.com/old.model3.json";
    const newUrl = "https://cdn.example.com/new.model3.json";
    const el = baseVtuber({ element_id: "vt_1", metadata: { model_url: newUrl } });
    const bySourceKey = { [getVtuberSourceKey({ ...el, metadata: { model_url: oldUrl } } as VtuberElement)]: "data:old" };
    const byElementId: Record<string, string> = { vt_1: "data:old" };
    expect(resolveVtuberEditorSnapshot(el, bySourceKey)).toBeUndefined();
    expect(byElementId[el.element_id]).toBe("data:old");
  });
});
