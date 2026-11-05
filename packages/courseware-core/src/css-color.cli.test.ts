// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "vitest";
import { compositeOverBackground, contrastRatio, parseCssColor } from "./css-color.ts";

test("parseCssColor supports hex and rgba", () => {
  assert.deepEqual(parseCssColor("#fff"), { r: 255, g: 255, b: 255, alpha: 1 });
  assert.deepEqual(parseCssColor("rgba(10, 20, 30, 0.5)"), { r: 10, g: 20, b: 30, alpha: 0.5 });
});

test("compositeOverBackground blends semi-transparent foreground", () => {
  const fg = parseCssColor("rgba(255, 255, 255, 0.5)");
  const bg = parseCssColor("#000000");
  assert.ok(fg && bg);
  const blended = compositeOverBackground(fg, bg);
  assert.equal(blended.r, 127.5);
});

test("contrastRatio increases for light-on-dark pairs", () => {
  const light = parseCssColor("#FFFFFF");
  const dark = parseCssColor("#0F172A");
  assert.ok(light && dark);
  assert.ok(contrastRatio(light, dark) > 10);
});
