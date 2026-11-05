// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

import { quizFeedbackVariant } from "./QuizFeedback.tsx";

describe("quizFeedbackVariant", () => {
  it("is neutral before a score exists", () => {
    expect(quizFeedbackVariant(null, 60, 100)).toBe("neutral");
  });

  it("compares with the pass score when there is one", () => {
    expect(quizFeedbackVariant(60, 60, 100)).toBe("pass");
    expect(quizFeedbackVariant(59, 60, 100)).toBe("partial");
    expect(quizFeedbackVariant(0, 60, 100)).toBe("fail");
  });

  it("does not call nothing earned a pass when the pass score is 0", () => {
    expect(quizFeedbackVariant(0, 0, 100)).toBe("fail");
    expect(quizFeedbackVariant(40, 0, 100)).toBe("partial");
    expect(quizFeedbackVariant(100, 0, 100)).toBe("pass");
  });

  it("uses the total when no pass score is set", () => {
    expect(quizFeedbackVariant(100, undefined, 100)).toBe("pass");
    expect(quizFeedbackVariant(50, null, 100)).toBe("partial");
  });
});
