// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import { mergeStreamingPreviewIntoMessages } from "./conversation-message-merge.ts";

test("mergeStreamingPreviewIntoMessages replaces trailing assistant and appends a_streaming", () => {
  const merged = mergeStreamingPreviewIntoMessages(
    [
      { id: "u1", role: "user", content: "hi" },
      { id: "a_hist_0", role: "assistant", content: "stale partial" },
    ],
    {
      active: true,
      updatedAt: new Date().toISOString(),
      content: "live tool output",
      blocks: [
        {
          type: "tool",
          id: "t1",
          toolName: "Bash",
          title: "run",
          output: "live tool output",
        },
      ],
    },
  );

  assert.equal(merged.length, 2);
  assert.equal(merged[1]?.id, "a_streaming");
  assert.equal(merged[1]?.role, "assistant");
  assert.match(merged[1]?.content ?? "", /live tool output/);
});
