// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { enrichElementValidationHint } from "./validation-hints.ts";

test("enrichElementValidationHint suggests style.z_index for root z_index", () => {
  const hint = enrichElementValidationHint([
    {
      path: "slide[0].children_elements[]",
      message: "this field has unspecified keys: z_index",
      value: { z_index: 3, element_type: "svg" },
    },
  ]);
  assert.match(hint ?? "", /style\.z_index/);
});

test("enrichElementValidationHint suggests text:str for numeric text", () => {
  const hint = enrichElementValidationHint([
    {
      path: "slide[1].children_elements[].text",
      message: "text must be a `string` type, but the final value was: `1`.",
      value: 1,
    },
  ]);
  assert.match(hint ?? "", /text:str/);
});

test("enrichElementValidationHint suggests color/bold for font_color", () => {
  const hint = enrichElementValidationHint([
    {
      path: "slide[1].children_elements[]",
      message: "this field has unspecified keys: font_color, font_weight",
      value: { font_color: "#fff", font_weight: 700 },
    },
  ]);
  assert.match(hint ?? "", /color/);
  assert.match(hint ?? "", /font_weight/);
});
