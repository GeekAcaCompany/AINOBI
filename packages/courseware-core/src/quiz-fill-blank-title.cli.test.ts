// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "vitest";

import {
  applyFillBlankTitleToQuestion,
  countFillBlankSlotsInTitle,
  DEFAULT_FILL_BLANK_ANSWER_LABEL,
  inlineBlankInputStyleForBlank,
  inlineBlankWidthEmForBlank,
  parseFillBlankTitleSegments,
  patchFillBlankTitleInLayout,
  syncFillBlankEntriesForTitle,
} from "./quiz-fill-blank-title.ts";
import type { QuizAstNode, QuizTag } from "./quiz-ast.ts";
import { createDefaultQuestionWithAst } from "./quiz-default-asts.ts";
import { validateQuizAst } from "./quiz-ast.ts";

test("parseFillBlankTitleSegments splits on underscore runs", () => {
  const segs = parseFillBlankTitleSegments("地球绕___公转，有___颗卫星");
  assert.deepEqual(
    segs.map((s) => (s.kind === "text" ? s.text : `blank${s.index}`)),
    ["地球绕", "blank0", "公转，有", "blank1", "颗卫星"],
  );
});

test("syncFillBlankEntriesForTitle grows and shrinks blanks", () => {
  const one = syncFillBlankEntriesForTitle("a___b", [{ blank_id: "bk1", answer: "x", aliases: [] }]);
  assert.equal(one.length, 1);
  const two = syncFillBlankEntriesForTitle("a___b___c", one);
  assert.equal(two.length, 2);
  assert.equal(two[0]!.blank_id, "bk1");
});

test("syncFillBlankEntriesForTitle preserves blanks when title has no underscores", () => {
  const blanks = [{ blank_id: "bk1", answer: "侘寂", aliases: ["wabi-sabi"] }];
  const out = syncFillBlankEntriesForTitle("侘び寂びの美学", blanks);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.blank_id, "bk1");
  assert.deepEqual(out[0]!.aliases, ["wabi-sabi"]);
});

test("default fill_blank AST has inline QuizInput in QuizTitle", () => {
  const synced = createDefaultQuestionWithAst("fill_blank", "zh");
  assert.equal(synced.type, "fill_blank");
  const issues = validateQuizAst(synced.react_layout, synced);
  assert.deepEqual(issues, []);
  const title = synced.react_layout.children.find(
    (c) => c.kind === "element" && c.tag === "QuizTitle",
  );
  assert.ok(title && title.kind === "element");
  const input = title.children.find((c) => c.kind === "element" && c.tag === "QuizInput");
  assert.ok(input && input.kind === "element");
  assert.equal(input.props.inline, true);
  assert.equal(countFillBlankSlotsInTitle(synced.title), synced.blanks.length);
  assert.equal(synced.blanks.length, 1);
  assert.equal(synced.blanks[0]?.answer, DEFAULT_FILL_BLANK_ANSWER_LABEL);
  assert.equal(input.props.style?.width, `${inlineBlankWidthEmForBlank(synced.blanks[0]!)}em`);
});

const astEl = (
  tag: QuizTag,
  props: Record<string, unknown> = {},
  children: QuizAstNode[] = [],
): QuizAstNode => ({ kind: "element", tag, props: props as never, children });

const countTag = (root: QuizAstNode, tag: QuizTag): number => {
  let n = 0;
  const walk = (node: QuizAstNode): void => {
    if (node.kind === "element" && node.tag === tag) n += 1;
    if (node.kind === "element" || node.kind === "stateBranch") {
      for (const ch of node.children) walk(ch);
    }
  };
  walk(root);
  return n;
};

test("patchFillBlankTitleInLayout dedupes QuizTitle and injects inline input", () => {
  const layout = astEl("QuizContainer", {}, [
    astEl("div", {}, [astEl("QuizTitle", { style: { fontSize: 20 } }, []), astEl("QuizTitle", {}, [])]),
    astEl("QuizTitle", {}, []),
  ]);
  const patched = patchFillBlankTitleInLayout(layout, "「___」美学", [
    { blank_id: "bk_wabi", answer: "侘寂", aliases: [] },
  ]);
  assert.equal(countTag(patched, "QuizTitle"), 1);
  assert.ok(JSON.stringify(patched).includes('"tag":"QuizInput"'));
  assert.ok(JSON.stringify(patched).includes("bk_wabi"));
});

test("applyFillBlankTitleToQuestion preserves blanks when title has no underscores", () => {
  const q = applyFillBlankTitleToQuestion({
    type: "fill_blank",
    question_id: "qz_q_x",
    title: "侘び寂びの美学",
    explanation: "",
    score: 10,
    required: true,
    pass_score: 0,
    advance_score: 0,
    allow_resubmit: false,
    show_feedback_score: true,
    time_limit_minutes: null,
    content_narration_audio_url: "",
    content_narration_duration_ms: 0,
    content_narration_vtuber_element_id: "",
    react_layout: astEl("QuizContainer", {}, [astEl("QuizTitle", {}, [])]),
    case_sensitive: false,
    grading: "exact_match",
    grading_criteria: "",
    blanks: [{ blank_id: "bk1", answer: "侘寂", aliases: [] }],
  });
  assert.equal(q.blanks.length, 1);
  assert.equal(q.blanks[0]!.blank_id, "bk1");
});

test("inlineBlankWidthEmForBlank uses reference answer only, not aliases", () => {
  assert.equal(inlineBlankWidthEmForBlank({ answer: "答案" }), 4);
  assert.equal(inlineBlankWidthEmForBlank({ answer: "北京" }), 4);
  assert.equal(
    inlineBlankWidthEmForBlank({ answer: "北京" }),
    inlineBlankWidthEmForBlank({ answer: "北京", aliases: ["北京市", "Peking"] } as never),
  );
  assert.deepEqual(inlineBlankInputStyleForBlank({ answer: "答案", aliases: ["很长别名"] }).textAlign, "center");
});
