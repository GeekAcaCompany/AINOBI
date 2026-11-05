// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";

import coursewareApi, {
  toLegacySubmitQuizAnswerBody,
  type SubmitCoursewareQuizAnswerRequest,
} from "./courseware.ts";
import { api, coursewareApi as coursewareServiceApi } from "../host/requester.ts";

// Mock transitive imports so the module under test loads without a real HTTP client.
vi.mock("../host/requester.ts", () => ({
  api: { get: vi.fn(), post: vi.fn() },
  coursewareApi: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const makeRequest = (
  overrides: Partial<SubmitCoursewareQuizAnswerRequest> = {},
): SubmitCoursewareQuizAnswerRequest => ({
  course_id: "course-1",
  section_id: "section-1",
  scene_id: "scene-1",
  slide_element_id: "element-1",
  question_wrapper_id: "wrapper-1",
  // The legacy body builder requires a question snapshot; a minimal object is enough.
  question: { type: "single_choice" },
  answer: { selected_option_ids: ["opt-1"] },
  ...overrides,
});

describe("toLegacySubmitQuizAnswerBody", () => {
  it("includes language in the legacy body when the request provides it", () => {
    const body = toLegacySubmitQuizAnswerBody(makeRequest({ language: "ja" }));

    expect(body.language).toBe("ja");
  });

  it("omits the language key entirely when the request has no language", () => {
    const body = toLegacySubmitQuizAnswerBody(makeRequest());

    expect(Object.prototype.hasOwnProperty.call(body, "language")).toBe(false);
  });
});

describe("coursewareApi.submitQuizAnswer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submits courseware-id previews without org gating", async () => {
    vi.mocked(coursewareServiceApi.post).mockResolvedValue({
      ok: true,
      data: {
        score: 1,
        max_score: 1,
        passed: true,
        can_advance: true,
        feedback: "ok",
      },
    });

    await expect(
      coursewareApi.submitQuizAnswer(null, {
        courseware_id: "cw-1",
        scene_id: "scene-1",
        slide_element_id: "slide-1",
        question_id: "question-1",
        question_wrapper_id: "wrapper-1",
        language: "zh",
        answer: { values: ["hello"] },
      }),
    ).resolves.toEqual({
      score: 1,
      max_score: 1,
      passed: true,
      can_advance: true,
      feedback: "ok",
    });

    expect(coursewareServiceApi.post).toHaveBeenCalledWith(
      "/courseware/quiz/evaluate",
      expect.objectContaining({
        courseware_id: "cw-1",
        scene_id: "scene-1",
        slide_element_id: "slide-1",
      }),
      { responseShape: "agent" },
    );
    expect(api.post).not.toHaveBeenCalled();
  });

  it("keeps legacy submit path requiring org id", async () => {
    await expect(
      coursewareApi.submitQuizAnswer(null, {
        scene_id: "scene-1",
        slide_element_id: "slide-1",
        question_wrapper_id: "wrapper-1",
        language: "zh",
        question: {
          type: "free_text",
          prompt: "prompt",
          score: 1,
          pass_score: 0,
          advance_score: 0,
          required: true,
          time_limit_minutes: null,
        },
        answer: { values: ["hello"] },
      }),
    ).rejects.toThrow("缺少组织 ID");
  });
});
