// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import {
  computeExposeInUserChat,
  isSdkSkillContextUserText,
} from "./transcript-entry-ui.ts";

test("isSdkSkillContextUserText uses SDK skill body shape", () => {
  assert.equal(
    isSdkSkillContextUserText("Base directory for this skill: /x\n\n# Title\n\nARGUMENTS: go"),
    true,
  );
  assert.equal(isSdkSkillContextUserText("请把封面线往下移"), false);
});

test("computeExposeInUserChat marks skill injection and synthetic rows", () => {
  assert.equal(
    computeExposeInUserChat({
      type: "user",
      message: {
        type: "user",
        content: [
          {
            type: "text",
            text: "Base directory for this skill: /repo/.claude/skills/foo\n\n# Skill\n\nARGUMENTS: status",
          },
        ],
      },
    } as never),
    false,
  );
  assert.equal(
    computeExposeInUserChat({
      type: "user",
      isSynthetic: true,
      message: { type: "user", content: [{ type: "text", text: "hidden" }] },
    } as never),
    false,
  );
  assert.equal(
    computeExposeInUserChat({
      type: "user",
      message: { type: "user", content: [{ type: "text", text: "用户真实输入" }] },
    } as never),
    true,
  );
});
