// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "vitest";

import { parseQuizJsx } from "./quiz-jsx-parser.ts";
import { validateQuizAst, type QuizAstNode } from "@ainobi/courseware-core/quiz-ast.ts";
import { createDefaultQuestion, type QuizFillBlankQuestion, type QuizQuestion } from "@ainobi/courseware-core/quiz.ts";

const buildSingleChoice = (): QuizQuestion => {
  const q = createDefaultQuestion("single_choice", "zh");
  if (q.type !== "single_choice") throw new Error("expected single_choice");
  q.options = [
    { option_id: "op_a", value: "A", is_correct: true },
    { option_id: "op_b", value: "B", is_correct: false },
  ];
  return q;
};

const buildFillBlank = (): QuizFillBlankQuestion => {
  const q = createDefaultQuestion("fill_blank", "zh");
  if (q.type !== "fill_blank") throw new Error("expected fill_blank");
  q.title = "Hello ___ on ___";
  q.blanks = [
    { blank_id: "bk_1", answer: "world", aliases: [] },
    { blank_id: "bk_2", answer: "earth", aliases: [] },
  ];
  return q;
};

const ast = (jsx: string): QuizAstNode => parseQuizJsx(jsx, "zh");

test("allows common presentation styles in JSX (textShadow, backdropFilter)", () => {
  const question = buildSingleChoice();
  const tree = ast(
    `<QuizContainer style={{ padding: 24 }}>
      <QuizTitle style={{ textShadow: "0 1px 2px rgba(0,0,0,0.15)" }}>{$title}</QuizTitle>
      <QuizOptionGroup>
        <QuizOption value="op_a" style={{ backdropFilter: "blur(6px)", backgroundColor: "rgba(255,255,255,0.7)" }}>A</QuizOption>
        <QuizOption value="op_b" style={{ backdropFilter: "blur(6px)" }}>B</QuizOption>
      </QuizOptionGroup>
      <QuizSubmitButton>提交</QuizSubmitButton>
    </QuizContainer>`,
  );
  const issues = validateQuizAst(tree, question);
  assert.deepEqual(issues, []);
});

test("rejects unknown props on QuizShadowingControl", () => {
  const question = createDefaultQuestion("shadowing", "zh");
  const tree = ast(
    `<QuizContainer>
      <QuizTitle>{$title}</QuizTitle>
      <QuizShadowingControl recordingIconSrc="data:image/png,abc" />
      <QuizSubmitButton>提交</QuizSubmitButton>
    </QuizContainer>`,
  );
  const issues = validateQuizAst(tree, question);
  assert.ok(
    issues.some(
      (i) =>
        i.path.endsWith(".recordingIconSrc") &&
        i.message.includes("not allowed on <QuizShadowingControl>"),
    ),
  );
});

test("allows transform and letterSpacing in JSX after permissive style sanitize", () => {
  const question = buildSingleChoice();
  const tree = ast(
    `<QuizContainer style={{ padding: 24, transform: "translateY(-2px)" }}>
      <QuizTitle style={{ letterSpacing: 0.5, fontSize: 22 }}>{$title}</QuizTitle>
      <QuizOptionGroup>
        <QuizOption value="op_a">A</QuizOption>
        <QuizOption value="op_b">B</QuizOption>
      </QuizOptionGroup>
      <QuizSubmitButton>提交</QuizSubmitButton>
    </QuizContainer>`,
  );
  const issues = validateQuizAst(tree, question);
  assert.deepEqual(issues, []);
});

test("allows JSX comments in children", () => {
  const question = buildSingleChoice();
  const tree = ast(
    `<QuizContainer>
      {/* card */}
      <QuizTitle>{$title}</QuizTitle>
      <QuizOptionGroup>
        <QuizOption value="op_a">A</QuizOption>
        <QuizOption value="op_b">B</QuizOption>
      </QuizOptionGroup>
      <QuizSubmitButton>提交</QuizSubmitButton>
    </QuizContainer>`,
  );
  const issues = validateQuizAst(tree, question);
  assert.deepEqual(issues, []);
});

test("valid single_choice AST passes", () => {
  const question = buildSingleChoice();
  const tree = ast(
    `<QuizContainer>
      <QuizTitle>{$title}</QuizTitle>
      <QuizOptionGroup>
        <QuizOption value="op_a">A</QuizOption>
        <QuizOption value="op_b">B</QuizOption>
      </QuizOptionGroup>
      <QuizSubmitButton>提交</QuizSubmitButton>
    </QuizContainer>`,
  );
  const issues = validateQuizAst(tree, question);
  assert.deepEqual(issues, []);
});

test("flags missing option coverage", () => {
  const question = buildSingleChoice();
  const tree = ast(
    `<QuizContainer>
      <QuizTitle>{$title}</QuizTitle>
      <QuizOptionGroup>
        <QuizOption value="op_a">A</QuizOption>
      </QuizOptionGroup>
      <QuizSubmitButton>Submit</QuizSubmitButton>
    </QuizContainer>`,
  );
  const issues = validateQuizAst(tree, question);
  assert.ok(issues.some((i) => i.message.includes("for every options[].option_id")));
});

test("flags unknown option value", () => {
  const question = buildSingleChoice();
  const tree = ast(
    `<QuizContainer>
      <QuizTitle>{$title}</QuizTitle>
      <QuizOptionGroup>
        <QuizOption value="op_a">A</QuizOption>
        <QuizOption value="op_b">B</QuizOption>
        <QuizOption value="op_c">C</QuizOption>
      </QuizOptionGroup>
      <QuizSubmitButton>Submit</QuizSubmitButton>
    </QuizContainer>`,
  );
  const issues = validateQuizAst(tree, question);
  assert.ok(issues.some((i) => i.message.includes("op_c")));
});

test("flags missing submit button", () => {
  const question = buildSingleChoice();
  const tree = ast(
    `<QuizContainer>
      <QuizTitle>{$title}</QuizTitle>
      <QuizOptionGroup>
        <QuizOption value="op_a">A</QuizOption>
        <QuizOption value="op_b">B</QuizOption>
      </QuizOptionGroup>
    </QuizContainer>`,
  );
  const issues = validateQuizAst(tree, question);
  assert.ok(issues.some((i) => i.message.includes("QuizSubmitButton")));
});

test("flags two submit buttons", () => {
  const question = buildSingleChoice();
  const tree = ast(
    `<QuizContainer>
      <QuizTitle>{$title}</QuizTitle>
      <QuizOptionGroup>
        <QuizOption value="op_a">A</QuizOption>
        <QuizOption value="op_b">B</QuizOption>
      </QuizOptionGroup>
      <QuizSubmitButton>Submit</QuizSubmitButton>
      <QuizSubmitButton>Another</QuizSubmitButton>
    </QuizContainer>`,
  );
  const issues = validateQuizAst(tree, question);
  assert.ok(issues.some((i) => i.message.includes("must appear exactly once")));
});

test("fill_blank requires QuizInput name for every blank", () => {
  const question = buildFillBlank();
  question.title = "Hello ___ on ___";
  question.blanks = question.blanks.slice(0, 2);
  const tree = ast(
    `<QuizContainer>
      <QuizTitle>Hello <QuizInput name="${question.blanks[0]!.blank_id}" inline /> on <QuizInput name="${question.blanks[1]!.blank_id}" inline /></QuizTitle>
      <QuizSubmitButton>Submit</QuizSubmitButton>
    </QuizContainer>`,
  );
  const issues = validateQuizAst(tree, question);
  assert.deepEqual(issues, []);
});

test("fill_blank flags missing blank id binding", () => {
  const question = buildFillBlank();
  const tree = ast(
    `<QuizContainer>
      <QuizTitle>Hello <QuizInput name="bk_1" /></QuizTitle>
      <QuizSubmitButton>Submit</QuizSubmitButton>
    </QuizContainer>`,
  );
  const issues = validateQuizAst(tree, question);
  assert.ok(issues.some((i) => i.message.includes("for every blanks[].blank_id")));
});

test("strips forbidden style values at parse normalize", () => {
  const question = buildSingleChoice();
  const tree = ast(
    `<QuizContainer>
      <QuizTitle style={{ background: "url(http://x)", color: "red" }}>{$title}</QuizTitle>
      <QuizOptionGroup>
        <QuizOption value="op_a">A</QuizOption>
        <QuizOption value="op_b">B</QuizOption>
      </QuizOptionGroup>
      <QuizSubmitButton>Submit</QuizSubmitButton>
    </QuizContainer>`,
  );
  assert.equal(tree.kind, "element");
  const title = tree.children.find(
    (c) => c.kind === "element" && c.tag === "QuizTitle",
  );
  assert.ok(title && title.kind === "element");
  assert.equal((title.props.style as Record<string, unknown>)?.background, undefined);
  assert.equal((title.props.style as Record<string, unknown>)?.color, "red");
  const issues = validateQuizAst(tree, question);
  assert.deepEqual(issues, []);
});

test("allows permissive style keys such as zIndex", () => {
  const question = buildSingleChoice();
  const tree = ast(
    `<QuizContainer>
      <QuizTitle style={{ zIndex: 9, color: "#111" }}>{$title}</QuizTitle>
      <QuizOptionGroup>
        <QuizOption value="op_a">A</QuizOption>
        <QuizOption value="op_b">B</QuizOption>
      </QuizOptionGroup>
      <QuizSubmitButton>Submit</QuizSubmitButton>
    </QuizContainer>`,
  );
  const issues = validateQuizAst(tree, question);
  assert.deepEqual(issues, []);
});

test("rejects nested QuizContainer", () => {
  const question = buildSingleChoice();
  const tree = ast(
    `<QuizContainer>
      <QuizTitle />
      <QuizContainer>
        <QuizOptionGroup>
          <QuizOption value="op_a">A</QuizOption>
          <QuizOption value="op_b">B</QuizOption>
        </QuizOptionGroup>
      </QuizContainer>
      <QuizSubmitButton>Submit</QuizSubmitButton>
    </QuizContainer>`,
  );
  const issues = validateQuizAst(tree, question);
  assert.ok(issues.some((i) => i.message.includes("only appear at the root")));
});

test("requires QuizContainer root", () => {
  const issues = validateQuizAst(
    { kind: "element", tag: "div", props: {}, children: [] } as QuizAstNode,
    buildSingleChoice(),
  );
  assert.ok(issues.some((i) => i.message.includes("root must be <QuizContainer>")));
});
