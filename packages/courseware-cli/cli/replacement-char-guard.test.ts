// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import { AinobiCliError } from "./errors.ts";
import {
  assertNoNewReplacementChars,
  assertNoReplacementCharsInFlags,
  findReplacementCharStrings,
} from "./replacement-char-guard.ts";

// Mirrors the production incident: a transcript line wrapped by a byte-based `awk substr`.
const corrupted = "�户，申请时要特别关注企业类别、语�";

const expectReplacementCharError = (fn: () => void): AinobiCliError => {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof AinobiCliError, "expected AinobiCliError");
  assert.equal(caught.code, "INVALID_INPUT");
  assert.match(caught.message, /U\+FFFD/);
  return caught;
};

test("findReplacementCharStrings walks nested objects and arrays", () => {
  const hits = findReplacementCharStrings(
    { slides: [{ children: [{ transcript: corrupted, name: "ok" }] }] },
    "scene",
  );
  assert.deepEqual(hits, [{ path: "scene.slides[0].children[0].transcript", value: corrupted }]);
});

test("assertNoNewReplacementChars rejects newly introduced U+FFFD with path and snippet", () => {
  const error = expectReplacementCharError(() =>
    assertNoNewReplacementChars({ text: "客户" }, { text: corrupted }),
  );
  assert.equal(error.issues[0]?.path, "scene.text");
  assert.match(error.issues[0]?.message ?? "", /语/);
  assert.match(error.hint ?? "", /awk substr/);
});

test("assertNoNewReplacementChars keeps legacy U+FFFD strings even when moved", () => {
  const previous = { slides: [{ text: corrupted }, { text: "b" }] };
  const next = { slides: [{ text: "b" }, { text: corrupted }, { text: "new clean copy" }] };
  assert.doesNotThrow(() => assertNoNewReplacementChars(previous, next));
});

test("assertNoNewReplacementChars rejects a legacy string that was edited but still corrupt", () => {
  expectReplacementCharError(() =>
    assertNoNewReplacementChars({ text: corrupted }, { text: `${corrupted}（追加）` }),
  );
});

test("assertNoNewReplacementChars accepts clean CJK text", () => {
  assert.doesNotThrow(() => assertNoNewReplacementChars(null, { text: "客户，申请时要特别关注企业类别、语言" }));
});

test("assertNoReplacementCharsInFlags reports the offending flag", () => {
  const error = expectReplacementCharError(() =>
    assertNoReplacementCharsInFlags({ "--script": "正常", "--transcript": corrupted }),
  );
  assert.deepEqual(
    error.issues.map((issue) => issue.path),
    ["--transcript"],
  );
  assert.doesNotThrow(() => assertNoReplacementCharsInFlags({ "--transcript": undefined }));
});

test("assertNoNewReplacementChars rejects an extra copy of a legacy corrupt string", () => {
  const previous = { slides: [{ text: corrupted }] };
  assert.doesNotThrow(() => assertNoNewReplacementChars(previous, { slides: [{ text: "x" }, { text: corrupted }] }));
  expectReplacementCharError(() =>
    assertNoNewReplacementChars(previous, { slides: [{ text: corrupted }, { text: corrupted }] }),
  );
});
