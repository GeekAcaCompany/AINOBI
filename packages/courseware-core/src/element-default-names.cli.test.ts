// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  applyDefaultElementNameIfEmpty,
  nextDefaultElementName,
  needsDefaultElementName,
} from "./element-default-names.ts";
import type { SlideElement } from "./elements.ts";

const slideWith = (
  children: Array<{ element_type: string; name?: string }>,
): Pick<SlideElement, "children_elements"> =>
  ({ children_elements: children }) as Pick<SlideElement, "children_elements">;

test("needsDefaultElementName treats blank as empty", () => {
  assert.equal(needsDefaultElementName(""), true);
  assert.equal(needsDefaultElementName("   "), true);
  assert.equal(needsDefaultElementName(undefined), true);
  assert.equal(needsDefaultElementName("标题"), false);
});

test("nextDefaultElementName increments per type on slide", () => {
  const slide = slideWith([
    { element_type: "image", name: "封面" },
    { element_type: "image", name: "图片1" },
    { element_type: "text", name: "文本1" },
  ]);
  assert.equal(nextDefaultElementName(slide, "image"), "图片3");
  assert.equal(nextDefaultElementName(slide, "text"), "文本2");
  assert.equal(nextDefaultElementName(slide, "rectangle"), "矩形1");
  assert.equal(nextDefaultElementName(slide, "arrow"), "箭头1");
});

test("applyDefaultElementNameIfEmpty preserves explicit names", () => {
  const slide = slideWith([]);
  const record: Record<string, unknown> = { name: "自定义" };
  assert.equal(applyDefaultElementNameIfEmpty(record, "image", slide), false);
  assert.equal(record.name, "自定义");
});

test("applyDefaultElementNameIfEmpty assigns numbered label", () => {
  const slide = slideWith([{ element_type: "line", name: "线条1" }]);
  const record: Record<string, unknown> = { name: "" };
  assert.equal(applyDefaultElementNameIfEmpty(record, "line", slide), true);
  assert.equal(record.name, "线条2");
});
