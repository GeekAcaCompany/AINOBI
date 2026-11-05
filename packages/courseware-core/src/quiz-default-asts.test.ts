// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "vitest";

import { buildDefaultQuizAst, createDefaultQuestionWithAst } from "./quiz-default-asts.ts";
import { validateQuizAst, type QuizAstNode } from "./quiz-ast.ts";
import type { ContentLanguage } from "./content-language.ts";
import {
  coerceQuizChoiceOptionsFromAgentPatch,
  createDefaultQuestion,
  normalizeQuizChoiceOptionValues,
  type QuizFillBlankQuestion,
  type QuizQuestionType,
} from "./quiz.ts";

const LANGUAGES: ContentLanguage[] = ["zh", "en", "ja"];

const TYPES: QuizQuestionType[] = [
  "single_choice",
  "multiple_choice",
  "fill_blank",
  "essay",
  "shadowing",
  "speech",
];

test("coerceQuizChoiceOptionsFromAgentPatch maps legacy option_text", () => {
  const options = coerceQuizChoiceOptionsFromAgentPatch([
    { option_text: "太平洋", is_correct: true } as never,
    { option_text: "大西洋", is_correct: false } as never,
  ]);
  assert.equal(options.length, 2);
  assert.ok(options[0]!.option_id.startsWith("qz_op_"));
  assert.equal(options[0]!.value, "太平洋");
  const q = createDefaultQuestion("single_choice", "zh");
  q.options = options;
  const ast = buildDefaultQuizAst(q, "zh");
  normalizeQuizChoiceOptionValues(q.options);
  q.react_layout = ast;
  const issues = validateQuizAst(ast, q);
  assert.deepEqual(issues, []);
});

test("choice default AST uses mistaken options[].value as option label before normalize", () => {
  const q = createDefaultQuestion("single_choice", "zh");
  q.options = [
    { option_id: "qz_op_1", value: "太阳", is_correct: false },
    { option_id: "qz_op_2", value: "月球", is_correct: true },
    { option_id: "qz_op_3", value: "火星", is_correct: false },
    { option_id: "qz_op_4", value: "金星", is_correct: false },
  ];
  const ast = buildDefaultQuizAst(q, "zh");
  const group = ast.children?.find(
    (c) => c.kind === "element" && c.tag === "QuizOptionGroup",
  );
  assert.ok(group && group.kind === "element");
  const labels = group.children
    .filter((c) => c.kind === "element" && c.tag === "QuizOption")
    .map((c) =>
      c.kind === "element"
        ? c.children.map((ch) => (ch.kind === "text" ? ch.text : "")).join("")
        : "",
    );
  assert.deepEqual(labels, ["太阳", "月球", "火星", "金星"]);
});

const findRecordingControl = (root: QuizAstNode): Extract<QuizAstNode, { kind: "element" }> | null => {
  if (root.kind === "element" && root.tag === "QuizShadowingControl") return root;
  const kids =
    root.kind === "element" || root.kind === "stateBranch" ? root.children : [];
  for (const child of kids) {
    const hit = findRecordingControl(child);
    if (hit) return hit;
  }
  return null;
};

const branchText = (root: QuizAstNode, when: string): string => {
  const walk = (node: QuizAstNode): string => {
    if (node.kind === "stateBranch" && node.when === when) {
      return node.children.map((c) => (c.kind === "text" ? c.text : "")).join("");
    }
    const kids = node.kind === "element" || node.kind === "stateBranch" ? node.children : [];
    for (const child of kids) {
      const hit = walk(child);
      if (hit) return hit;
    }
    return "";
  };
  return walk(root);
};

const findElementTag = (root: QuizAstNode, tag: string): boolean => {
  if (root.kind === "element" && root.tag === tag) return true;
  const kids = root.kind === "element" || root.kind === "stateBranch" ? root.children : [];
  return kids.some((c) => findElementTag(c, tag));
};

test("fill_blank default AST uses inline inputs from underscores in title", () => {
  const synced = createDefaultQuestionWithAst("fill_blank", "zh");
  assert.equal(synced.type, "fill_blank");
  const title = synced.react_layout.children.find(
    (c) => c.kind === "element" && c.tag === "QuizTitle",
  );
  assert.ok(title && title.kind === "element");
  assert.ok(
    title.children.some((c) => c.kind === "element" && c.tag === "QuizInput"),
    "expected inline QuizInput in QuizTitle",
  );
  assert.ok(
    !synced.react_layout.children.some((c) => c.kind === "element" && c.tag === "ol"),
    "legacy list layout should not be used",
  );
});

test("shadowing and speech default AST use mic + 开始录音 / 暂停录音 branches", () => {
  for (const type of ["shadowing", "speech"] as const) {
    const q = createDefaultQuestion(type, "zh");
    const ast = buildDefaultQuizAst(q, "zh");
    const control = findRecordingControl(ast);
    assert.ok(control, `${type}: missing QuizShadowingControl`);
    assert.equal(branchText(ast, "idle"), "开始录音");
    assert.equal(branchText(ast, "recording"), "暂停录音");
    const idleBranch = control.children.find((c) => c.kind === "stateBranch" && c.when === "idle");
    assert.ok(
      idleBranch?.kind === "stateBranch" &&
        idleBranch.children.some((c) => c.kind === "element" && c.tag === "img"),
      `${type}: idle branch should include mic icon`,
    );
    assert.ok(findElementTag(ast, "QuizRecordingTimer"), `${type}: missing QuizRecordingTimer`);
    // Reference audio is for scoring only (shadowing and speech alike): never in the learner layout.
    assert.ok(
      !findElementTag(ast, "QuizReferenceAudio"),
      `${type}: scoring reference audio must not appear in default learner layout`,
    );
  }
});

test("choice default AST places action buttons in a row before explanation", () => {
  const q = createDefaultQuestion("single_choice", "zh");
  const ast = buildDefaultQuizAst(q, "zh");
  const actionRow = ast.children?.[2];
  assert.ok(actionRow?.kind === "element" && actionRow.tag === "div");
  const tags =
    actionRow.kind === "element"
      ? actionRow.children
          .filter((c) => c.kind === "element")
          .map((c) => (c.kind === "element" ? c.tag : ""))
      : [];
  assert.deepEqual(tags, [
    "QuizSubmitButton",
    "QuizSkipButton",
    "QuizResubmitButton",
    "QuizContinueButton",
  ]);
  const explanation = ast.children?.[3];
  assert.ok(explanation?.kind === "element" && explanation.tag === "QuizExplanation");
});

for (const language of LANGUAGES) {
  for (const type of TYPES) {
  test(`default AST for ${type} (${language}) passes validateQuizAst`, () => {
    const q = createDefaultQuestion(type, language);
    const ast = buildDefaultQuizAst(q, language);
    q.react_layout = ast;
    const issues = validateQuizAst(ast, q);
    assert.deepEqual(
      issues,
      [],
      `default AST for ${type} should pass: ${issues.map((i) => `${i.path}: ${i.message}`).join(" | ")}`,
    );
  });
  }
}

const findElement = (
  root: QuizAstNode,
  tag: string,
): Extract<QuizAstNode, { kind: "element" }> | null => {
  if (root.kind === "element" && root.tag === tag) return root;
  const kids = root.kind === "element" || root.kind === "stateBranch" ? root.children : [];
  for (const child of kids) {
    const hit = findElement(child, tag);
    if (hit) return hit;
  }
  return null;
};

const textOf = (node: QuizAstNode | null | undefined): string =>
  node && (node.kind === "element" || node.kind === "stateBranch")
    ? node.children.map((c) => (c.kind === "text" ? c.text : "")).join("")
    : "";

const EXPECTED_COPY: Record<ContentLanguage, Record<string, string>> = {
  zh: {
    idle: "开始录音",
    recording: "暂停录音",
    explanation: "解析",
    score: "得分",
    submit: "提交",
    skip: "跳过",
    retry: "重新作答",
    continue: "继续",
    essayPlaceholder: "写下你的回答…",
    title: "请在此输入题干",
  },
  en: {
    idle: "Start recording",
    recording: "Stop recording",
    explanation: "Answer explanation",
    score: "Score",
    submit: "Submit",
    skip: "Skip",
    retry: "Try again",
    continue: "Continue",
    essayPlaceholder: "Please enter your answer...",
    title: "Enter the question here",
  },
  ja: {
    idle: "録音開始",
    recording: "録音停止",
    explanation: "解答解説",
    score: "得点",
    submit: "送信",
    skip: "スキップ",
    retry: "再回答",
    continue: "続ける",
    essayPlaceholder: "回答を入力してください...",
    title: "ここに設問を入力",
  },
};

for (const language of LANGUAGES) {
  test(`shadowing / speech default AST copy follows language=${language}`, () => {
    const expected = EXPECTED_COPY[language];
    for (const type of ["shadowing", "speech"] as const) {
      const q = createDefaultQuestionWithAst(type, language);
      const ast = q.react_layout;
      assert.equal(q.title, expected.title, `${type}: title`);
      assert.equal(branchText(ast, "idle"), expected.idle, `${type}: idle`);
      assert.equal(branchText(ast, "recording"), expected.recording, `${type}: recording`);
      assert.equal(textOf(findElement(ast, "QuizSubmitButton")), expected.submit, `${type}: submit`);
      assert.equal(textOf(findElement(ast, "QuizSkipButton")), expected.skip, `${type}: skip`);
      assert.equal(textOf(findElement(ast, "QuizResubmitButton")), expected.retry, `${type}: retry`);
      assert.equal(textOf(findElement(ast, "QuizContinueButton")), expected.continue, `${type}: continue`);
      const explanation = findElement(ast, "QuizExplanation");
      assert.equal(textOf(explanation?.children[0]), expected.explanation, `${type}: explanation heading`);
      const feedback = findElement(ast, "QuizFeedback");
      assert.equal(textOf(feedback?.children[0]), expected.score, `${type}: score label`);
    }
  });

  test(`essay default AST placeholder and title follow language=${language}`, () => {
    const expected = EXPECTED_COPY[language];
    const q = createDefaultQuestionWithAst("essay", language);
    assert.equal(q.title, expected.title);
    const textarea = findElement(q.react_layout, "QuizTextarea");
    assert.equal(textarea?.props.placeholder, expected.essayPlaceholder);
  });
}

const EXPECTED_FILL_BLANK: Record<ContentLanguage, { title: string; answer: string }> = {
  zh: { title: "请输入题干：_____", answer: "答案" },
  en: { title: "Enter the stem here: _____", answer: "Answer" },
  ja: { title: "設問を入力：_____", answer: "解答" },
};

for (const language of LANGUAGES) {
  test(`fill_blank default stem and starter answer follow language=${language}`, () => {
    const expected = EXPECTED_FILL_BLANK[language];
    const q = createDefaultQuestionWithAst("fill_blank", language) as QuizFillBlankQuestion;
    assert.equal(q.title, expected.title);
    assert.match(q.title, /_____/, "underscore slot must survive localization");
    assert.equal(q.blanks.length, 1);
    assert.equal(q.blanks[0]?.answer, expected.answer);
    assert.ok(findElement(q.react_layout, "QuizInput"), "inline QuizInput expected in title");
  });
}
