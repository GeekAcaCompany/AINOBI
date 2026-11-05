// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import {
  collectQuizSlideMediaWarnings,
  isLikelyQuizMediaMisplacementOverlap,
} from "./element-quiz-media-warnings.ts";

const quizChild = {
  element_id: "el_quiz_abc",
  element_type: "quiz",
  x: 100,
  y: 140,
  width: 1720,
  height: 860,
};

test("no warnings when slide has no quiz", () => {
  const issues = collectQuizSlideMediaWarnings({
    slideIndex: 1,
    elementType: "image",
    position: { x: 1460, y: 160 },
    size: { width: 380, height: 520 },
    slideChildren: [],
    allowSlideMedia: false,
  });
  assert.equal(issues.length, 0);
});

test("warns on overlap with quiz frame", () => {
  const issues = collectQuizSlideMediaWarnings({
    slideIndex: 1,
    elementType: "image",
    position: { x: 1460, y: 160 },
    size: { width: 380, height: 520 },
    slideChildren: [quizChild],
    allowSlideMedia: false,
  });
  assert.equal(issues.length, 1);
  assert.match(issues[0]!.message, /overlaps quiz/i);
  assert.match(issues[0]!.message, /QuizMedia/);
});

test("soft warn when quiz exists but boxes do not overlap", () => {
  const issues = collectQuizSlideMediaWarnings({
    slideIndex: 1,
    elementType: "image",
    position: { x: 0, y: 0 },
    size: { width: 80, height: 80 },
    slideChildren: [quizChild],
    allowSlideMedia: false,
  });
  assert.equal(issues.length, 1);
  assert.match(issues[0]!.message, /belongs inside the question/i);
});

test("--allow-slide-media suppresses warnings", () => {
  const issues = collectQuizSlideMediaWarnings({
    slideIndex: 1,
    elementType: "image",
    position: { x: 1460, y: 160 },
    size: { width: 380, height: 520 },
    slideChildren: [quizChild],
    allowSlideMedia: true,
  });
  assert.equal(issues.length, 0);
});

test("isLikelyQuizMediaMisplacementOverlap detects quiz+image", () => {
  assert.equal(
    isLikelyQuizMediaMisplacementOverlap(
      { element_type: "quiz" },
      { element_type: "image" },
    ),
    true,
  );
  assert.equal(
    isLikelyQuizMediaMisplacementOverlap(
      { element_type: "text" },
      { element_type: "image" },
    ),
    false,
  );
});
