// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "vitest";

import { coerceFillBlankBlanksFromAgentPatch } from "./quiz.ts";

test("coerceFillBlankBlanksFromAgentPatch maps acceptable_answers to aliases", () => {
  const blanks = coerceFillBlankBlanksFromAgentPatch([
    {
      blank_id: "bk1",
      answer: "侘寂",
      acceptable_answers: { "0": "侘寂", "1": "wabi-sabi" },
    } as never,
  ]);
  assert.equal(blanks[0]!.answer, "侘寂");
  assert.deepEqual(blanks[0]!.aliases, ["侘寂", "wabi-sabi"]);
});

test("coerceFillBlankBlanksFromAgentPatch tolerates missing aliases", () => {
  const blanks = coerceFillBlankBlanksFromAgentPatch([
    { blank_id: "bk1", answer: "答案" } as never,
  ]);
  assert.deepEqual(blanks[0]!.aliases, []);
});
