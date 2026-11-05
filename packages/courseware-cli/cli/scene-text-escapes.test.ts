// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultQuizConfig, createDefaultQuestionWithAst } from "@ainobi/courseware-core";
import { normalizeLiteralEscapesInScene } from "./scene-text-escapes.ts";

test("normalizeLiteralEscapesInScene decodes literal \\n in text elements", () => {
  const scene = {
    slide_elements: [
      {
        element_id: "el_slide_1",
        element_type: "slide",
        name: "Slide",
        position: { x: 0, y: 0 },
        size: { width: 1920, height: 1080 },
        timeline: { start_at: 0, end_at: 5000 },
        style: { z_index: 0 },
        children_elements: [
          {
            element_id: "el_text_1",
            element_type: "text",
            name: "Body",
            text: "第一行\\n第二行",
            font_family: "Inter",
            font_size: 24,
            color: "#000000",
            align: "left",
            position: { x: 0, y: 0 },
            size: { width: 400, height: 120 },
            timeline: { start_at: 0, end_at: 5000 },
            style: { z_index: 1 },
          },
        ],
      },
    ],
    quiz: createDefaultQuizConfig(),
  } as const;

  const normalized = normalizeLiteralEscapesInScene(scene as never);
  const text = normalized.slide_elements[0]?.children_elements[0];
  assert.equal(text?.element_type, "text");
  if (text?.element_type === "text") {
    assert.equal(text.text, "第一行\n第二行");
  }
});

test("normalizeLiteralEscapesInScene decodes literal \\n in quiz title and AST text", () => {
  const question = createDefaultQuestionWithAst("single_choice", "zh");
  question.title = "题干\\n第二行";
  question.react_layout = {
    kind: "element",
    tag: "QuizTitle",
    props: {},
    children: [{ kind: "text", text: "选项A\\n说明" }],
  };

  const scene = {
    slide_elements: [
      {
        element_id: "el_slide_1",
        element_type: "slide",
        name: "Slide",
        position: { x: 0, y: 0 },
        size: { width: 1920, height: 1080 },
        timeline: { start_at: 0, end_at: 5000 },
        style: { z_index: 0 },
        children_elements: [],
      },
    ],
    quiz: { ...createDefaultQuizConfig(), questions: [question] },
  } as const;

  const normalized = normalizeLiteralEscapesInScene(scene as never);
  const saved = normalized.quiz?.questions[0];
  assert.equal(saved?.title, "题干\n第二行");
  const titleChild = saved?.react_layout;
  assert.equal(titleChild?.kind, "element");
  if (titleChild?.kind === "element") {
    assert.equal(titleChild.children[0]?.kind, "text");
    if (titleChild.children[0]?.kind === "text") {
      assert.equal(titleChild.children[0].text, "选项A\n说明");
    }
  }
});
