// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, beforeEach } from "vitest";

import {
  pushCoursewareEditorRecentColor,
  readCoursewareEditorRecentColors,
} from "./courseware-editor-recent-colors.ts";

describe("courseware-editor-recent-colors", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores up to 10 recent colors with newest first", () => {
    pushCoursewareEditorRecentColor("#4472C4");
    pushCoursewareEditorRecentColor("#ED7D31");
    pushCoursewareEditorRecentColor("#4472C4");

    expect(readCoursewareEditorRecentColors()).toEqual(["#4472c4", "#ed7d31"]);
  });

  it("ignores invalid colors", () => {
    pushCoursewareEditorRecentColor("not-a-color");
    expect(readCoursewareEditorRecentColors()).toEqual([]);
  });
});
