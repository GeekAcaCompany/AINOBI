// SPDX-License-Identifier: AGPL-3.0-only
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { normalizeQuizAst, type QuizAstNode } from "@ainobi/courseware-core/quiz-ast.ts";
import { parseQuizJsx } from "./quiz-jsx-parser.ts";
import { quizAstToJsx } from "./quiz-jsx-printer.ts";

const referencesDir = join(fileURLToPath(new URL("..", import.meta.url)), "references");
const canonical = (node: QuizAstNode): string => JSON.stringify(normalizeQuizAst(node, { fillRootContainer: true }));

test("every quiz reference example round-trips through quizAstToJsx", () => {
  const examples = readdirSync(referencesDir).filter((name) => /^quiz-.*\.example\.jsx$/.test(name));
  assert.ok(examples.length >= 4, `expected quiz examples, found ${examples.join(", ")}`);
  for (const name of examples) {
    const raw = readFileSync(join(referencesDir, name), "utf-8");
    // Root element starts a line; leading comments may mention tags too.
    const root = raw.search(/^<QuizContainer/m);
    assert.ok(root >= 0, name);
    const source = raw.slice(root);
    const ast = parseQuizJsx(source, "zh");
    const printed = quizAstToJsx(ast);
    assert.equal(canonical(parseQuizJsx(printed, "zh")), canonical(ast), name);
  }
});

test("props, styles, state branches and interpolation print in parser syntax", () => {
  const ast: QuizAstNode = {
    kind: "element",
    tag: "QuizContainer",
    props: { padding: 24, style: { backgroundColor: "#fff", "--accent": "red" } },
    children: [
      { kind: "element", tag: "QuizTitle", props: {}, children: [{ kind: "interp", key: "title" }] },
      {
        kind: "element",
        tag: "QuizInput",
        props: { name: "b1", placeholder: 'say "hi"', inline: true },
        children: [],
      },
      {
        kind: "stateBranch",
        when: "recording",
        props: { style: { color: "red" } },
        children: [{ kind: "text", text: "录音中" }],
      },
    ],
  };
  const printed = quizAstToJsx(ast);
  assert.match(printed, /<QuizContainer padding=\{24\} style=\{\{ backgroundColor: "#fff", "--accent": "red" \}\}>/);
  assert.match(printed, /\{\$title\}/);
  assert.match(printed, /<QuizInput name="b1" placeholder="say \\"hi\\"" inline \/>/);
  assert.match(printed, /<QuizStateView when="recording" style=\{\{ color: "red" \}\}>/);
});

test("text the JSX subset cannot express is detected by the round trip", () => {
  const ast: QuizAstNode = {
    kind: "element",
    tag: "QuizContainer",
    props: {},
    children: [{ kind: "element", tag: "p", props: {}, children: [{ kind: "text", text: "a < b" }] }],
  };
  const printed = quizAstToJsx(ast);
  let roundTrips = false;
  try {
    roundTrips = canonical(parseQuizJsx(printed, "zh")) === canonical(ast);
  } catch {
    roundTrips = false;
  }
  assert.equal(roundTrips, false);
});
