// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import { buildPatchFromSetEntries, deepMerge } from "./patch.ts";

test("deepMerge merges options[] by index for is_correct patches", () => {
  const target = {
    options: [
      { option_id: "qz_op_a", value: "qz_op_a", is_correct: false },
      { option_id: "qz_op_b", value: "qz_op_b", is_correct: false },
    ],
  };
  const patch = buildPatchFromSetEntries(["options[1].is_correct=true"]);
  const merged = deepMerge(target, patch);
  assert.equal(merged.options[0].option_id, "qz_op_a");
  assert.equal(merged.options[1].option_id, "qz_op_b");
  assert.equal(merged.options[1].is_correct, true);
});

test("deepMerge merges multiple option is_correct flags in one patch", () => {
  const target = {
    options: [
      { option_id: "qz_op_a", value: "qz_op_a", is_correct: false },
      { option_id: "qz_op_b", value: "qz_op_b", is_correct: false },
      { option_id: "qz_op_c", value: "qz_op_c", is_correct: false },
    ],
  };
  const patch = buildPatchFromSetEntries([
    "options[0].is_correct=false",
    "options[1].is_correct=true",
    "options[2].is_correct=false",
  ]);
  const merged = deepMerge(target, patch);
  assert.equal(merged.options[1].is_correct, true);
  assert.equal(merged.options[0].option_id, "qz_op_a");
  assert.equal(merged.options[2].option_id, "qz_op_c");
});
