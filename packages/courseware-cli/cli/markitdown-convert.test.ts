// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import { convertBufferToMarkdown } from "./markitdown-convert.ts";

test("convertBufferToMarkdown converts plain text", async () => {
  const buffer = Buffer.from("Hello courseware\nLine two.", "utf8");
  const result = await convertBufferToMarkdown(buffer, {
    file_extension: ".txt",
    use_llm_for_images: false,
  });
  assert.match(result.markdown, /Hello courseware/);
  assert.equal(result.llm_used, false);
});
