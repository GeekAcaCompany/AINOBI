// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "vitest";

import { auditQuizLayoutSizing, type QuizAstNode } from "./quiz-ast.ts";
import { defaultQuizElementLayoutForSlide } from "./quiz.ts";

const el = (
  tag: string,
  props: Record<string, unknown> = {},
  children: QuizAstNode[] = [],
): QuizAstNode =>
  ({
    kind: "element",
    tag,
    props,
    children,
  }) as QuizAstNode;

test("auditQuizLayoutSizing warns when QuizContainer root lacks 100% fill", () => {
  const root = el("QuizContainer", { style: { display: "flex", height: "100%" } }, []);
  const messages = auditQuizLayoutSizing(root);
  assert.ok(messages.some((m) => m.includes('width/height "100%"')));
});

test("auditQuizLayoutSizing warns on inner fixed-width card", () => {
  const root = el(
    "QuizContainer",
    { style: { width: "100%", height: "100%", display: "flex", justifyContent: "center" } },
    [
      el("div", { style: { width: 680, padding: 48, background: "#fff" } }, [
        el("QuizTitle", {}, []),
      ]),
    ],
  );
  const messages = auditQuizLayoutSizing(root);
  assert.ok(messages.some((m) => m.includes("680px")));
});

test("auditQuizLayoutSizing passes full-bleed layout", () => {
  const root = el(
    "QuizContainer",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: 48,
      },
    },
    [el("section", { style: { width: "100%", flex: 1 } }, []), el("QuizTitle", {}, [])],
  );
  assert.deepEqual(auditQuizLayoutSizing(root), []);
});

test("auditQuizLayoutSizing ignores small control widths", () => {
  const root = el(
    "QuizContainer",
    { style: { width: "100%", height: "100%" } },
    [el("QuizShadowingControl", { style: { width: 100, height: 100 } }, [])],
  );
  assert.deepEqual(auditQuizLayoutSizing(root), []);
});

test("defaultQuizElementLayoutForSlide fills standard 1920x1080 slide with margins", () => {
  const layout = defaultQuizElementLayoutForSlide({ size: { width: 1920, height: 1080 } });
  assert.deepEqual(layout.position, { x: 80, y: 60 });
  assert.deepEqual(layout.size, { width: 1760, height: 960 });
});
