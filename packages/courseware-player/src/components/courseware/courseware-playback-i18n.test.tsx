// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import type { PPTElement } from "../../lib/courseware/index.ts";
import type { QuizQuestion } from "@ainobi/courseware-core/quiz.ts";

import { PPTRenderer } from "./PPTRenderer.tsx";
import { QuizRenderer } from "./quiz/QuizRenderer.tsx";
import { QuizSubmitButton } from "./quiz/QuizSubmitButton.tsx";

// FT7: playback components resolve their default texts through i18n. The UI
// language is pinned to "en" via storage (read by useI18nNew outside the
// provider), so a hardcoded-Chinese regression fails these assertions.

beforeEach(() => {
  window.localStorage.setItem("ainobi-ui-language", "en");
});

afterEach(() => {
  window.localStorage.removeItem("ainobi-ui-language");
  window.sessionStorage.removeItem("ainobi-ui-language");
});

const pptElement = {
  element_id: "el_ppt_test",
  src: "",
  slide_ranges: [],
  slide_count: 0,
} as unknown as PPTElement;

const invalidLayoutQuestion = { react_layout: null } as unknown as QuizQuestion;

describe("courseware playback i18n fallbacks", () => {
  it("PPTRenderer renders the localized empty state", () => {
    render(<PPTRenderer element={pptElement} />);
    expect(screen.getByText("No PPT URL set")).toBeTruthy();
  });

  it("QuizRenderer renders the localized invalid-layout notice", () => {
    render(<QuizRenderer question={invalidLayoutQuestion} />);
    expect(screen.getByText(/react_layout/)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Invalid question layout");
  });

  it("quiz buttons fall back to localized labels when the AST gives none", () => {
    // Skip/Resubmit/Continue share the same `children ?? t(...)` pattern but
    // render null without a QuizFormContext; Submit renders standalone.
    render(<QuizSubmitButton />);
    expect(screen.getByText("Submit")).toBeTruthy();
  });
});
