// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

import { omitAuthorSetKeys } from "./quiz-style-merge.ts";

describe("omitAuthorSetKeys", () => {
  it("drops borderWidth/borderStyle when author uses border shorthand", () => {
    const merged = omitAuthorSetKeys(
      { borderWidth: 1, borderStyle: "solid", padding: "12px 28px" },
      { border: "2px solid #ccc5b8", width: 100 },
    );
    expect(merged.borderWidth).toBeUndefined();
    expect(merged.borderStyle).toBeUndefined();
    expect(merged.padding).toBe("12px 28px");
  });
});
