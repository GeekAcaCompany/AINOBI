// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "vitest";

import { parseQuizJsxWithMeta } from "./quiz-jsx-parser.ts";
import { ensureQuizAstInterpSlots, inspectQuizAstInterpSlots } from "@ainobi/courseware-core/quiz-ast-interp-fill.ts";
import type { QuizAstNode } from "@ainobi/courseware-core/quiz-ast.ts";

const el = (
  tag: Extract<QuizAstNode, { kind: "element" }>["tag"],
  children: QuizAstNode[] = [],
): QuizAstNode => ({ kind: "element", tag, props: {}, children });

test("ensureQuizAstInterpSlots injects {$title} into empty QuizTitle", () => {
  const layout = el("QuizContainer", [el("QuizTitle")]);
  const { ast, layout_interp_fixes } = ensureQuizAstInterpSlots(layout, "zh");
  assert.ok(layout_interp_fixes.some((m) => m.includes("QuizTitle")));
  const title = ast.kind === "element" ? ast.children[0] : null;
  assert.ok(title && title.kind === "element" && title.tag === "QuizTitle");
  assert.equal(title.children[0]?.kind, "interp");
  if (title.children[0]?.kind === "interp") {
    assert.equal(title.children[0].key, "title");
  }
});

test("ensureQuizAstInterpSlots injects explanation into empty QuizExplanation p", () => {
  const layout = el("QuizContainer", [
    el("QuizTitle", [{ kind: "interp", key: "title" }]),
    el("QuizExplanation", [el("p")]),
  ]);
  const { ast, layout_interp_fixes } = ensureQuizAstInterpSlots(layout, "zh");
  assert.ok(layout_interp_fixes.some((m) => m.includes("QuizExplanation")));
  const explanation = ast.kind === "element" ? ast.children[1] : null;
  assert.ok(explanation && explanation.kind === "element");
  const paragraph = explanation.children[0];
  assert.ok(paragraph && paragraph.kind === "element" && paragraph.tag === "p");
  assert.equal(paragraph.children[0]?.kind, "interp");
});

test("ensureQuizAstInterpSlots defaults empty QuizSubmitButton label", () => {
  const layout = el("QuizContainer", [el("QuizSubmitButton")]);
  const { ast, layout_interp_fixes } = ensureQuizAstInterpSlots(layout, "zh");
  assert.ok(layout_interp_fixes.some((m) => m.includes("QuizSubmitButton")));
  const button = ast.kind === "element" ? ast.children[0] : null;
  assert.ok(button && button.kind === "element");
  assert.equal(button.children[0]?.kind, "text");
  if (button.children[0]?.kind === "text") {
    assert.equal(button.children[0].text, "提交");
  }
});

const buttonLabels = (ast: QuizAstNode): string[] =>
  ast.kind === "element"
    ? ast.children.map((child) =>
        child.kind === "element" && child.children[0]?.kind === "text" ? child.children[0].text : "",
      )
    : [];

test("ensureQuizAstInterpSlots fills action button labels in the scene content language", () => {
  const layout = () =>
    el("QuizContainer", [
      el("QuizSubmitButton"),
      el("QuizSkipButton"),
      el("QuizResubmitButton"),
      el("QuizContinueButton"),
    ]);
  const en = ensureQuizAstInterpSlots(layout(), "en");
  assert.deepEqual(buttonLabels(en.ast), ["Submit", "Skip", "Try again", "Continue"]);
  assert.ok(en.layout_interp_fixes.some((m) => m.includes('"Submit"')));
  assert.ok(en.layout_interp_fixes.every((m) => !/提交|跳过|重新作答|继续/.test(m)));

  const ja = ensureQuizAstInterpSlots(layout(), "ja");
  assert.deepEqual(buttonLabels(ja.ast), ["送信", "スキップ", "再回答", "続ける"]);

  // Explicit labels are never overwritten, whatever the language.
  const labeled = ensureQuizAstInterpSlots(
    el("QuizContainer", [el("QuizSubmitButton", [{ kind: "text", text: "Go" }])]),
    "ja",
  );
  assert.deepEqual(buttonLabels(labeled.ast), ["Go"]);
  assert.deepEqual(labeled.layout_interp_fixes, []);
});

test("parseQuizJsxWithMeta accepts <interp key=\"title\" /> sugar", () => {
  const { ast, layout_interp_fixes } = parseQuizJsxWithMeta(
    `<QuizContainer><QuizTitle><interp key="title" /></QuizTitle><QuizSubmitButton>提交</QuizSubmitButton></QuizContainer>`,
    "zh",
  );
  const title = ast.kind === "element" ? ast.children[0] : null;
  assert.ok(title && title.kind === "element");
  assert.equal(title.children[0]?.kind, "interp");
  assert.deepEqual(layout_interp_fixes, []);
});

test("parseQuizJsxWithMeta auto-fills empty styled QuizTitle from jsx-file pattern", () => {
  const { ast, layout_interp_fixes } = parseQuizJsxWithMeta(
    `<QuizContainer style={{ display: "flex" }}><QuizTitle style={{ fontSize: 28 }} /><QuizSubmitButton style={{ padding: 12 }}>提交</QuizSubmitButton></QuizContainer>`,
    "zh",
  );
  assert.ok(layout_interp_fixes.some((m) => m.includes("QuizTitle")));
  const title = ast.kind === "element" ? ast.children[0] : null;
  assert.ok(title && title.kind === "element");
  assert.equal(title.children[0]?.kind, "interp");
});

test("parseQuizJsxWithMeta fills self-closing buttons in the requested language", () => {
  const { ast, layout_interp_fixes } = parseQuizJsxWithMeta(
    `<QuizContainer><QuizTitle>{$title}</QuizTitle><QuizSubmitButton /></QuizContainer>`,
    "en",
  );
  assert.deepEqual(layout_interp_fixes, ['<QuizSubmitButton> had no label — defaulted to "Submit"']);
  assert.deepEqual(buttonLabels(ast), ["", "Submit"]);
});

test("inspectQuizAstInterpSlots reports missing dynamic slots", () => {
  const layout = el("QuizContainer", [el("QuizTitle")]);
  const report = inspectQuizAstInterpSlots(layout);
  assert.deepEqual(report.missing_slots, ["title", "explanation"]);
});
