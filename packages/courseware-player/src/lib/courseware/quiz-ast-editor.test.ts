// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  applyQuizLayoutAstMutation,
  canDeleteQuizAstNode,
  classifyQuizAstNodeRole,
  computeQuizAstHorizontalBuddyDrop,
  computeQuizAstMoveToContainer,
  executeQuizAstDrop,
  isQuizAstRowGroup,
  getQuizAstNodeAtPath,
  isQuizAstDropContainer,
  joinQuizAstPath,
  moveQuizAstNodeAtPath,
  patchQuizAstContainerAlign,
  patchQuizAstStyleAtPath,
  removeQuizAstNodeAtPath,
  removeQuizAstStyleKeyAtPath,
  resolveQuizAstDeletePath,
  resolveQuizAstDragPath,
  resolveQuizAstResizePath,
  resolveQuizAstTextEditPath,
  setQuizAstTextAtPath,
  updateQuizAstNodeAtPath,
} from "./quiz-ast-editor.ts";
import { createDefaultQuestionWithAst } from "@ainobi/courseware-core/quiz-default-asts.ts";
import type { QuizMultipleChoiceQuestion } from "@ainobi/courseware-core/quiz.ts";

describe("quiz-ast-editor", () => {
  const question = createDefaultQuestionWithAst(
    "multiple_choice",
    "en",
  ) as QuizMultipleChoiceQuestion;
  const layout = question.react_layout!;

  it("resolves nodes by path", () => {
    const title = getQuizAstNodeAtPath(layout, "children[0]");
    expect(title?.kind).toBe("element");
    if (title?.kind === "element") expect(title.tag).toBe("QuizTitle");
  });

  it("edits a single text node without touching siblings", () => {
    const firstOption = "children[1].children[0]";
    const textPath = joinQuizAstPath(firstOption, 0);
    const before = getQuizAstNodeAtPath(layout, textPath);
    expect(before?.kind).toBe("text");

    const updated = setQuizAstTextAtPath(layout, textPath, "Hello");
    const after = getQuizAstNodeAtPath(updated, textPath);
    expect(after?.kind).toBe("text");
    if (after?.kind === "text") expect(after.text).toBe("Hello");

    // A different option's text must be unchanged.
    const sibling = getQuizAstNodeAtPath(updated, "children[1].children[1].children[0]");
    const original = getQuizAstNodeAtPath(layout, "children[1].children[1].children[0]");
    expect(sibling).toEqual(original);
  });

  it("patches and removes style keys immutably", () => {
    const colored = patchQuizAstStyleAtPath(layout, "children[0]", { color: "#ff0000" });
    const styled = getQuizAstNodeAtPath(colored, "children[0]");
    if (styled?.kind === "element") {
      expect(styled.props.style).toMatchObject({ color: "#ff0000" });
    }
    // Original layout untouched (still has its authored color, not #ff0000).
    const originalTitle = getQuizAstNodeAtPath(layout, "children[0]");
    if (originalTitle?.kind === "element") {
      expect((originalTitle.props.style as Record<string, unknown>)?.color).not.toBe("#ff0000");
    }

    const cleared = removeQuizAstStyleKeyAtPath(colored, "children[0]", "color");
    const clearedNode = getQuizAstNodeAtPath(cleared, "children[0]");
    if (clearedNode?.kind === "element") {
      expect((clearedNode.props.style as Record<string, unknown>)?.color).toBeUndefined();
    }
  });

  it("classifies node roles", () => {
    expect(classifyQuizAstNodeRole(getQuizAstNodeAtPath(layout, "")!, "")).toBe("root");
    expect(classifyQuizAstNodeRole(getQuizAstNodeAtPath(layout, "children[0]")!, "children[0]")).toBe(
      "functional_style",
    );
    const titleInterp = getQuizAstNodeAtPath(layout, "children[0].children[0]");
    expect(classifyQuizAstNodeRole(titleInterp!, "children[0].children[0]")).toBe("interp_field");
    const optionText = getQuizAstNodeAtPath(layout, "children[1].children[0].children[0]");
    expect(classifyQuizAstNodeRole(optionText!, "children[1].children[0].children[0]")).toBe(
      "text_editable",
    );
  });

  it("moves an element and reports the follow-up path", () => {
    const result = moveQuizAstNodeAtPath(layout, "children[2].children[3]", -1);
    expect(result).not.toBeNull();
    expect(result!.nextPath).toBe("children[2].children[2]");
    const moved = getQuizAstNodeAtPath(result!.layout, "children[2].children[2]");
    if (moved?.kind === "element") expect(moved.tag).toBe("QuizContinueButton");
    // Out-of-range move is rejected.
    expect(moveQuizAstNodeAtPath(layout, "children[0]", -1)).toBeNull();
  });

  it("only deletes decorative nodes free of functional descendants", () => {
    // Functional node cannot be deleted.
    expect(canDeleteQuizAstNode(layout, "children[1]")).toBe(false);
    expect(removeQuizAstNodeAtPath(layout, "children[1]")).toBeNull();

    // The decorative <p> inside QuizExplanation can be deleted.
    const pPath = "children[3].children[0]";
    const pNode = getQuizAstNodeAtPath(layout, pPath);
    expect(pNode?.kind).toBe("element");
    expect(canDeleteQuizAstNode(layout, pPath)).toBe(true);
    const removed = removeQuizAstNodeAtPath(layout, pPath);
    expect(removed).not.toBeNull();
    expect(removed!.nextPath).toBe("children[3]");
  });

  it("resolves resize paths to nearest style-bearing element", () => {
    expect(resolveQuizAstResizePath(layout, "children[0].children[0]")).toBe("children[0]");
    expect(resolveQuizAstResizePath(layout, "children[2].children[0].children[0]")).toBe(
      "children[2].children[0]",
    );
    expect(resolveQuizAstResizePath(layout, "children[3].children[0].children[0]")).toBe(
      "children[3].children[0]",
    );
  });

  it("resolves delete paths to nearest deletable decorative node", () => {
    expect(resolveQuizAstDeletePath(layout, "children[1]")).toBeNull();
    expect(resolveQuizAstDeletePath(layout, "children[3].children[0]")).toBe("children[3].children[0]");
    expect(resolveQuizAstDeletePath(layout, "children[3].children[0].children[0]")).toBe(
      "children[3].children[0]",
    );
    expect(resolveQuizAstDeletePath(layout, "children[3].children[1].children[0]")).toBe(
      "children[3].children[1]",
    );
  });

  it("resolves structural drag paths (no dragging inner explanation chrome)", () => {
    expect(resolveQuizAstDragPath(layout, "children[3]")).toBe("children[3]");
    expect(resolveQuizAstDragPath(layout, "children[3].children[0]")).toBe("children[3]");
    expect(resolveQuizAstDragPath(layout, "children[3].children[1].children[0]")).toBe("children[3]");
    expect(resolveQuizAstDragPath(layout, "children[2]")).toBe("children[2]");
    expect(resolveQuizAstDragPath(layout, "children[2].children[0]")).toBe("children[2].children[0]");
    expect(resolveQuizAstDragPath(layout, "children[1].children[0].children[0]")).toBe(
      "children[1].children[0]",
    );
    expect(resolveQuizAstDragPath(layout, "")).toBeNull();
  });

  it("resolves text edit paths inside functional components", () => {
    expect(resolveQuizAstTextEditPath(layout, "children[1].children[0].children[0]")).toBe(
      "children[1].children[0].children[0]",
    );
    expect(resolveQuizAstTextEditPath(layout, "children[1].children[0]")).toBe(
      "children[1].children[0].children[0]",
    );
    expect(resolveQuizAstTextEditPath(layout, "children[3]")).toBe("children[3].children[0].children[0]");
  });

  it("identifies drop containers", () => {
    expect(isQuizAstDropContainer(getQuizAstNodeAtPath(layout, ""))).toBe(true);
    expect(isQuizAstDropContainer(getQuizAstNodeAtPath(layout, "children[1]"))).toBe(true);
    expect(isQuizAstDropContainer(getQuizAstNodeAtPath(layout, "children[2]"))).toBe(true);
    expect(isQuizAstDropContainer(getQuizAstNodeAtPath(layout, "children[1].children[0]"))).toBe(false);
    expect(isQuizAstDropContainer(getQuizAstNodeAtPath(layout, "children[1].children[0].children[0]"))).toBe(
      false,
    );
  });

  it("wraps column siblings in a row when dropped beside each other", () => {
    const uprootResubmit = computeQuizAstMoveToContainer(
      layout,
      question,
      "children[2].children[2]",
      "",
      5,
    );
    expect(uprootResubmit).not.toBeNull();
    const result = computeQuizAstHorizontalBuddyDrop(
      uprootResubmit!.layout,
      question,
      uprootResubmit!.nextPath,
      "children[2].children[1]",
      "right",
    );
    expect(result).not.toBeNull();
    const row = getQuizAstNodeAtPath(result!.layout, "children[2]");
    expect(isQuizAstRowGroup(row)).toBe(true);
    if (row?.kind === "element" && row.children) {
      expect(row.children[0]?.kind === "element" && row.children[0].tag).toBe("QuizSubmitButton");
      expect(row.children[1]?.kind === "element" && row.children[1].tag).toBe("QuizSkipButton");
      expect(row.children[2]?.kind === "element" && row.children[2].tag).toBe("QuizResubmitButton");
    }
    expect(result!.nextPath).toBe("children[2].children[2]");
  });

  it("inserts into an existing row group without re-wrapping", () => {
    const uprootContinue = computeQuizAstMoveToContainer(
      layout,
      question,
      "children[2].children[3]",
      "",
      5,
    );
    expect(uprootContinue).not.toBeNull();
    const result = executeQuizAstDrop(uprootContinue!.layout, question, uprootContinue!.nextPath, {
      kind: "horizontal-buddy",
      anchorPath: "children[2].children[2]",
      side: "right",
    });
    expect(result).not.toBeNull();
    const row = getQuizAstNodeAtPath(result!.layout, "children[2]");
    if (row?.kind === "element" && row.children) {
      expect(row.children.length).toBe(4);
      expect(row.children[2]?.kind === "element" && row.children[2].tag).toBe("QuizResubmitButton");
      expect(row.children[3]?.kind === "element" && row.children[3].tag).toBe("QuizContinueButton");
    }
  });

  it("reorders siblings via drag with index adjustment", () => {
    const result = computeQuizAstMoveToContainer(layout, question, "children[2].children[0]", "", 0);
    expect(result).not.toBeNull();
    const moved = getQuizAstNodeAtPath(result!.layout, "children[0]");
    if (moved?.kind === "element") expect(moved.tag).toBe("QuizSubmitButton");
    expect(result!.nextPath).toBe("children[0]");
  });

  it("refuses to drop a node into its own subtree", () => {
    expect(computeQuizAstMoveToContainer(layout, question, "children[1]", "children[1]", 0)).toBeNull();
    expect(
      computeQuizAstMoveToContainer(layout, question, "children[1]", "children[1].children[0]", 0),
    ).toBeNull();
  });

  it("patches container align styles", () => {
    const centered = patchQuizAstContainerAlign(layout, "children[2].children[0]", "center");
    const node = getQuizAstNodeAtPath(centered, "children[2].children[0]");
    if (node?.kind === "element") {
      expect(node.props.style).toMatchObject({
        alignSelf: "center",
        marginLeft: "auto",
        marginRight: "auto",
      });
    }
  });

  it("reparents an element into another container when still valid", () => {
    // Move the submit button into the explanation container (index 3) — the
    // node is preserved, so the layout stays valid.
    const result = computeQuizAstMoveToContainer(
      layout,
      question,
      "children[2].children[0]",
      "children[3]",
      0,
    );
    expect(result).not.toBeNull();
    const parent = getQuizAstNodeAtPath(result!.layout, "children[3]");
    if (parent?.kind === "element") {
      // The submit button no longer sits at the old top-level index 2.
      const moved = getQuizAstNodeAtPath(result!.layout, result!.nextPath);
      expect(moved?.kind === "element" && moved.tag).toBe("QuizSubmitButton");
    }
  });

  it("validates before accepting a mutation", () => {
    const bad = applyQuizLayoutAstMutation(layout, question, (current) =>
      updateQuizAstNodeAtPath(current, "", (root) => {
        if (root.kind !== "element") return root;
        // Drop the option group → validator should reject.
        return { ...root, children: root.children.filter((_, i) => i !== 1) };
      }),
    );
    expect(bad?.issues.length).toBeGreaterThan(0);
    // Rejected mutations return the original layout untouched.
    expect(bad?.layout).toBe(layout);

    const good = applyQuizLayoutAstMutation(layout, question, (current) =>
      patchQuizAstStyleAtPath(current, "children[0]", { fontSize: 24 }),
    );
    expect(good?.issues).toEqual([]);
  });
});
