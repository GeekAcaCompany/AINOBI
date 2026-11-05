// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import { buildPatchFromSetEntries } from "./patch.ts";
import { decodeStringEscapes, normalizeMultilineCliText } from "./cli-text.ts";

test("decodeStringEscapes decodes common C-style escapes", () => {
  assert.equal(decodeStringEscapes("a\\nb"), "a\nb");
  assert.equal(decodeStringEscapes("tab\\there"), "tab\there");
  assert.equal(decodeStringEscapes("quote\\\"x"), 'quote"x');
  assert.equal(decodeStringEscapes("\\u0041"), "A");
});

test("decodeStringEscapes drops spurious backslashes before punctuation (agent shell quirks)", () => {
  assert.equal(decodeStringEscapes("Hello, World\\!"), "Hello, World!");
  assert.equal(decodeStringEscapes("price\\$9"), "price$9");
  assert.equal(decodeStringEscapes("a\\,b"), "a,b");
});

test("decodeStringEscapes preserves intentional backslashes via doubling", () => {
  assert.equal(decodeStringEscapes("path\\\\file"), "path\\file");
  assert.equal(decodeStringEscapes("literal\\\\!"), "literal\\!");
});

test("buildPatchFromSetEntries applies escape decoding to text fields", () => {
  const patch = buildPatchFromSetEntries(["text=Hello, World\\!"]);
  assert.equal(patch.text, "Hello, World!");
});

test("buildPatchFromSetEntries decodes \\n consistently for default and :str paths", () => {
  assert.deepEqual(buildPatchFromSetEntries(["text=第一行\\n第二行"]), {
    text: "第一行\n第二行",
  });
  assert.deepEqual(buildPatchFromSetEntries(["text:str=第一行\\n第二行"]), {
    text: "第一行\n第二行",
  });
  assert.deepEqual(buildPatchFromSetEntries(['text="第一行\\n第二行"']), {
    text: "第一行\n第二行",
  });
});

test("normalizeMultilineCliText still decodes \\n across passes", () => {
  assert.equal(normalizeMultilineCliText("第一行\\n第二行"), "第一行\n第二行");
  assert.equal(normalizeMultilineCliText("wow\\!\\nnext"), "wow!\nnext");
});
