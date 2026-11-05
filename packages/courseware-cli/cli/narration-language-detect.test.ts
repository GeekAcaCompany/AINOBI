// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTranscriptLanguageMismatchWarning,
  detectTranscriptLanguage,
  normalizeTeacherLanguage,
} from "./narration-language-detect.ts";

test("normalizeTeacherLanguage accepts common aliases", () => {
  assert.equal(normalizeTeacherLanguage("zh"), "zh");
  assert.equal(normalizeTeacherLanguage("zh-CN"), "zh");
  assert.equal(normalizeTeacherLanguage("Chinese"), "zh");
  assert.equal(normalizeTeacherLanguage("ja-JP"), "ja");
  assert.equal(normalizeTeacherLanguage("Japanese"), "ja");
  assert.equal(normalizeTeacherLanguage("en-US"), "en");
  assert.equal(normalizeTeacherLanguage("xx"), undefined);
  assert.equal(normalizeTeacherLanguage(""), undefined);
  assert.equal(normalizeTeacherLanguage(undefined), undefined);
});

test("detectTranscriptLanguage classifies Japanese via kana", () => {
  assert.equal(detectTranscriptLanguage("こんにちは、皆さん"), "ja");
  assert.equal(detectTranscriptLanguage("カタカナの文章です"), "ja");
});

test("detectTranscriptLanguage classifies Chinese via CJK ideographs only", () => {
  assert.equal(
    detectTranscriptLanguage("大家好，欢迎来到今天的课程。"),
    "zh",
  );
});

test("detectTranscriptLanguage classifies English via Latin letters", () => {
  assert.equal(
    detectTranscriptLanguage("Hello everyone, welcome to today's lecture."),
    "en",
  );
});

test("detectTranscriptLanguage returns undefined for empty / pure punctuation", () => {
  assert.equal(detectTranscriptLanguage(""), undefined);
  assert.equal(detectTranscriptLanguage("..., 123 !!"), undefined);
});

test("buildTranscriptLanguageMismatchWarning warns on zh transcript + ja teacher", () => {
  const warning = buildTranscriptLanguageMismatchWarning({
    transcript: "大家好，欢迎来到今天的课程。",
    teacherLanguage: "ja",
    warningPath: "slide_elements[0].children_elements",
  });
  assert.ok(warning);
  assert.match(warning.message, /Chinese/);
  assert.match(warning.message, /Japanese/);
  assert.equal(warning.path, "slide_elements[0].children_elements");
});

test("buildTranscriptLanguageMismatchWarning returns null when matched", () => {
  assert.equal(
    buildTranscriptLanguageMismatchWarning({
      transcript: "Hello everyone, welcome.",
      teacherLanguage: "en-US",
      warningPath: "x",
    }),
    null,
  );
  assert.equal(
    buildTranscriptLanguageMismatchWarning({
      transcript: "大家好",
      teacherLanguage: "zh",
      warningPath: "x",
    }),
    null,
  );
});

test("buildTranscriptLanguageMismatchWarning skips unknown teacher language", () => {
  assert.equal(
    buildTranscriptLanguageMismatchWarning({
      transcript: "大家好，欢迎来到今天的课程。",
      teacherLanguage: undefined,
      warningPath: "x",
    }),
    null,
  );
  assert.equal(
    buildTranscriptLanguageMismatchWarning({
      transcript: "大家好",
      teacherLanguage: "xx",
      warningPath: "x",
    }),
    null,
  );
});
