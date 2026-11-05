// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { AinobiCliError } from "./errors.ts";
import { normalizeMultilineCliText } from "./cli-text.ts";
import {
  assertNarrationTtsLineBreakPolicy,
  MAX_NARRATION_TTS_CHARS_WITHOUT_LINE_BREAK,
  resolveNarrationTranscriptStored,
  resolveNarrationTtsSource,
} from "./narration-transcript-rules.ts";

test("resolveNarrationTtsSource falls back to script when transcript empty", () => {
  assert.equal(resolveNarrationTtsSource("only script", ""), "only script");
  assert.equal(resolveNarrationTtsSource("only script", "   "), "only script");
  assert.equal(resolveNarrationTtsSource("s", "t"), "t");
});

test("resolveNarrationTranscriptStored mirrors TTS source for empty transcript", () => {
  assert.equal(resolveNarrationTranscriptStored("hello", ""), "hello");
  assert.equal(resolveNarrationTranscriptStored("hello", "world"), "world");
});

test("assertNarrationTtsLineBreakPolicy allows long text with newline", () => {
  const long = `${"x".repeat(60)}\nline2`;
  assert.doesNotThrow(() => assertNarrationTtsLineBreakPolicy(long));
});

test("assertNarrationTtsLineBreakPolicy allows up to max chars without newline", () => {
  const ok = "x".repeat(MAX_NARRATION_TTS_CHARS_WITHOUT_LINE_BREAK);
  assert.doesNotThrow(() => assertNarrationTtsLineBreakPolicy(ok));
});

test("assertNarrationTtsLineBreakPolicy rejects too long without newline", () => {
  const bad = "x".repeat(MAX_NARRATION_TTS_CHARS_WITHOUT_LINE_BREAK + 1);
  assert.throws(
    () => assertNarrationTtsLineBreakPolicy(bad),
    (err: unknown) => err instanceof AinobiCliError && err.code === "USAGE",
  );
});

test("normalizeMultilineCliText decodes literal \\n from single-quoted shell args", () => {
  assert.equal(normalizeMultilineCliText("第一行\\n第二行"), "第一行\n第二行");
});

test("normalizeMultilineCliText leaves real newlines unchanged", () => {
  assert.equal(normalizeMultilineCliText("第一行\n第二行"), "第一行\n第二行");
});
