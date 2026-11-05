// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  areRequiredQuizWrappersComplete,
  computeCoursewareLearningProgressPercent,
} from "./learning-progress.ts";

describe("computeCoursewareLearningProgressPercent", () => {
  it("returns 0 when total duration is zero", () => {
    expect(computeCoursewareLearningProgressPercent(5000, 0)).toBe(0);
  });

  it("clamps to 0–100", () => {
    expect(computeCoursewareLearningProgressPercent(-100, 10000)).toBe(0);
    expect(computeCoursewareLearningProgressPercent(5000, 10000)).toBe(50);
    expect(computeCoursewareLearningProgressPercent(15000, 10000)).toBe(100);
  });
});

describe("areRequiredQuizWrappersComplete", () => {
  it("requires every listed wrapper to be submitted or skipped", () => {
    expect(
      areRequiredQuizWrappersComplete(["a", "b"], {
        a: { submitted: true },
        b: { skipped: true },
      }),
    ).toBe(true);
    expect(
      areRequiredQuizWrappersComplete(["a", "b"], {
        a: { submitted: true },
        b: {},
      }),
    ).toBe(false);
    expect(
      areRequiredQuizWrappersComplete(["a"], {
        a: { submitted: true },
        c: { submitted: true },
      }),
    ).toBe(true);
  });
});
