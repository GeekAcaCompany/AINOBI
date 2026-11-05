// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  applyEvenSplitToQuizConfig,
  computeEvenQuestionScores,
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
    const q1 = { ...createDefaultQuestion("single_choice", "en"), question_id: "a" };
    const q2 = { ...createDefaultQuestion("essay", "en"), question_id: "b" };
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
});
