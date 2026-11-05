// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

import { extractQuizOptionLabelFromAst, type QuizAstNode } from "./quiz-ast.ts";

describe("extractQuizOptionLabelFromAst", () => {
  it("collects nested text inside QuizOption bubbles", () => {
    const layout: QuizAstNode = {
      kind: "element",
      tag: "QuizContainer",
      props: {},
      children: [
        {
          kind: "element",
          tag: "QuizOption",
          props: { value: "qz_op_a" },
          children: [
            {
              kind: "element",
              tag: "div",
              props: {},
              children: [
                { kind: "text", text: "A" },
                {
                  kind: "element",
                  tag: "span",
                  props: {},
                  children: [{ kind: "text", text: "Python" }],
                },
                { kind: "text", text: "🐍" },
              ],
            },
          ],
        },
      ],
    };
    expect(extractQuizOptionLabelFromAst(layout, "qz_op_a")).toBe("APython🐍");
  });

  it("returns empty when option is missing", () => {
    expect(extractQuizOptionLabelFromAst(null, "qz_op_x")).toBe("");
  });
});
