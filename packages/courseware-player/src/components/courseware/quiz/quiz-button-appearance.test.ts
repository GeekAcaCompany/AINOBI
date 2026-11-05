// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

import {
  mergeQuizPrimaryButtonStyle,
  mergeQuizRecordingActiveStyle,
  mergeQuizSecondaryButtonStyle,
  resolveQuizPrimaryButtonVisualState,
} from "./quiz-button-appearance.ts";

describe("quiz primary button appearance", () => {
  it("resolves disabled before hover", () => {
    expect(
      resolveQuizPrimaryButtonVisualState({
        disabled: true,
        submitting: false,
        hovered: true,
        pressed: true,
      }),
    ).toBe("disabled");
  });

  it("resolves submitting over hover", () => {
    expect(
      resolveQuizPrimaryButtonVisualState({
        disabled: false,
        submitting: true,
        hovered: true,
        pressed: false,
      }),
    ).toBe("submitting");
  });

  it("applies distinct hover and disabled backgrounds for default chrome", () => {
    const hover = mergeQuizPrimaryButtonStyle(undefined, "hover");
    const disabled = mergeQuizPrimaryButtonStyle(undefined, "disabled");
    expect(hover.backgroundColor).not.toBe(disabled.backgroundColor);
    expect(disabled.cursor).toBe("not-allowed");
  });

  it("uses blue accent for enabled idle submit when author has no colors", () => {
    const idle = mergeQuizPrimaryButtonStyle(undefined, "idle");
    expect(idle.backgroundColor).toBe("#2563eb");
    expect(idle.color).toBe("#ffffff");
  });

  it("preserves author brand colors instead of default blue theme", () => {
    const author = {
      width: 100,
      height: 100,
      minWidth: 100,
      background: "#c9a96e",
      color: "#ffffff",
      border: "none",
      borderRadius: 50,
    };
    const idle = mergeQuizPrimaryButtonStyle(author, "idle");
    expect(idle.background).toBe("#c9a96e");
    expect(idle.color).toBe("#ffffff");
    expect(idle.minWidth).toBe(100);
    expect(idle.backgroundColor).toBeUndefined();
  });

  it("uses filter feedback on hover when author customized colors", () => {
    const hover = mergeQuizPrimaryButtonStyle({ backgroundColor: "#c9a96e" }, "hover");
    expect(hover.backgroundColor).toBe("#c9a96e");
    expect(hover.filter).toBe("brightness(0.96)");
  });

  it("mergeQuizRecordingActiveStyle applies author recordingStyle", () => {
    const active = mergeQuizRecordingActiveStyle(
      { background: "#ffffff", border: "2px solid #ccc5b8" },
      { background: "#e53e3e", border: "2px solid #c53030" },
    );
    expect(active.background).toBe("#e53e3e");
    expect(active.border).toBe("2px solid #c53030");
  });
});

describe("quiz secondary button appearance", () => {
  it("preserves author gold continue button styling", () => {
    const author = {
      color: "#ffffff",
      background: "#c9a96e",
      border: "none",
      borderRadius: 20,
      padding: "10px 28px",
    };
    const idle = mergeQuizSecondaryButtonStyle(author, "idle");
    expect(idle.background).toBe("#c9a96e");
    expect(idle.color).toBe("#ffffff");
    expect(idle.backgroundColor).not.toBe("transparent");
  });
});
