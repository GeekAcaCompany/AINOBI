// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  applyEvenSplitToQuizConfig,
  applyProportionalScoresToQuizConfig,
  computeEvenQuestionScores,
  computeProportionalQuestionScores,
  createDefaultQuestion,
  createDefaultQuizConfig,
} from "./quiz.ts";

describe("quiz score allocation", () => {
  it("splits totals into integer parts that sum exactly", () => {
    expect(computeEvenQuestionScores(100, 4)).toEqual([25, 25, 25, 25]);
    expect(computeEvenQuestionScores(100, 3)).toEqual([34, 33, 33]);
    expect(computeEvenQuestionScores(7, 3)).toEqual([3, 2, 2]);
    expect(computeEvenQuestionScores(0, 5)).toEqual([0, 0, 0, 0, 0]);
  });

  it("applyEvenSplitToQuizConfig keeps score sum equal to total_score", () => {
    const base = createDefaultQuizConfig();
    const q1 = { ...createDefaultQuestion("single_choice", "zh"), question_id: "a" };
    const q2 = { ...createDefaultQuestion("essay", "zh"), question_id: "b" };
    const cfg = {
      ...base,
      enabled: true,
      total_score: 100,
      score_allocation: "even_split" as const,
      questions: [q1, q2],
    };
    const out = applyEvenSplitToQuizConfig(cfg);
    const sum = out.questions.reduce((s, q) => s + q.score, 0);
    expect(sum).toBe(100);
    expect(out.questions.map((q) => q.score)).toEqual([50, 50]);
  });

  it("computeProportionalQuestionScores keeps ratios and integer sum", () => {
    expect(computeProportionalQuestionScores(100, [100, 100])).toEqual([50, 50]);
    expect(computeProportionalQuestionScores(100, [60, 40, 100])).toEqual([30, 20, 50]);
    expect(computeProportionalQuestionScores(100, [100, 40])).toEqual([71, 29]);
    expect(computeProportionalQuestionScores(100, [0, 0, 0])).toEqual([34, 33, 33]);
  });

  it("applyProportionalScoresToQuizConfig scales pass/advance with scores", () => {
    const base = createDefaultQuizConfig();
    const q1 = {
      ...createDefaultQuestion("single_choice", "zh"),
      question_id: "a",
      score: 60,
      pass_score: 60,
      advance_score: 60,
    };
    const q2 = {
      ...createDefaultQuestion("essay", "zh"),
      question_id: "b",
      score: 40,
      pass_score: 40,
      advance_score: 40,
    };
    const q3 = {
      ...createDefaultQuestion("single_choice", "zh"),
      question_id: "c",
      score: 100,
      pass_score: 100,
      advance_score: 100,
    };
    const out = applyProportionalScoresToQuizConfig({
      ...base,
      total_score: 100,
      score_allocation: "custom",
      questions: [q1, q2, q3],
    });
    expect(out.questions.map((q) => q.score)).toEqual([30, 20, 50]);
    expect(out.questions.map((q) => q.pass_score)).toEqual([30, 20, 50]);
    expect(out.questions.reduce((s, q) => s + q.score, 0)).toBe(100);
  });
});
