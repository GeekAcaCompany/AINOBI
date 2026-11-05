// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import type { QuizAstNode } from "./quiz-ast.ts";
import {
  isAllowedStateBranchWhen,
  resolveStateBranchContent,
  validateStateBranchChildren,
} from "./quiz-state-branches.ts";

const branch = (when: string, children: QuizAstNode[]): QuizAstNode => ({
  kind: "stateBranch",
  when,
  props: {},
  children,
});

const img = (src: string): QuizAstNode => ({
  kind: "element",
  tag: "img",
  props: { src, alt: "" },
  children: [],
});

describe("resolveStateBranchContent", () => {
  it("picks the matching branch content and style", () => {
    const children: QuizAstNode[] = [
      {
        kind: "stateBranch",
        when: "idle",
        props: {},
        children: [img("idle.svg")],
      },
      {
        kind: "stateBranch",
        when: "recording",
        props: { style: { background: "#e53e3e" } },
        children: [img("recording.svg")],
      },
    ];
    const recording = resolveStateBranchContent(children, "recording");
    assert.equal(recording.contentNodes.length, 1);
    assert.equal(
      (recording.contentNodes[0] as { props: { src: string } }).props.src,
      "recording.svg",
    );
    assert.equal(recording.hostStyle?.background, "#e53e3e");
  });

  it("treats unbranched nodes as idle legacy content", () => {
    const children: QuizAstNode[] = [img("legacy.svg")];
    const idle = resolveStateBranchContent(children, "idle");
    assert.equal((idle.contentNodes[0] as { props: { src: string } }).props.src, "legacy.svg");
    const recording = resolveStateBranchContent(children, "recording");
    assert.equal((recording.contentNodes[0] as { props: { src: string } }).props.src, "legacy.svg");
  });

  it("falls back to idle branch when active state has no branch", () => {
    const children: QuizAstNode[] = [
      branch("idle", [img("idle.svg")]),
      branch("recording", [img("rec.svg")]),
    ];
    const disabled = resolveStateBranchContent(children, "disabled");
    assert.equal((disabled.contentNodes[0] as { props: { src: string } }).props.src, "idle.svg");
  });
});

describe("validateStateBranchChildren", () => {
  it("rejects unknown when values on QuizShadowingControl", () => {
    const issues = validateStateBranchChildren("QuizShadowingControl", [
      branch("flying", []),
    ]);
    assert.ok(issues.some((m) => m.includes('when="flying"')));
  });

  it("rejects QuizStateView under unsupported hosts", () => {
    const issues = validateStateBranchChildren("QuizTitle", [branch("idle", [])]);
    assert.ok(issues.some((m) => m.includes("QuizTitle")));
  });

  it("flags duplicate when values", () => {
    const issues = validateStateBranchChildren("QuizShadowingControl", [
      branch("idle", []),
      branch("idle", []),
    ]);
    assert.ok(issues.some((m) => m.includes("duplicate")));
  });
});

describe("isAllowedStateBranchWhen", () => {
  it("knows shadowing control states", () => {
    assert.equal(isAllowedStateBranchWhen("QuizShadowingControl", "recording"), true);
    assert.equal(isAllowedStateBranchWhen("QuizShadowingControl", "hover"), false);
  });
});
