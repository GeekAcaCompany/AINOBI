// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { loadSceneTolerantly, repairQuizJsonNode } from "./scene-load-repair.ts";

// FT5: load-repair notices localize by the language param; the default ("zh")
// keeps the historical Chinese output.

const dirtyQuiz = () => ({
  enabled: true,
  total_score: 10,
  questions: [],
  grade_levels: [],
  time_limit_seconds: 90,
  bogus_key: 1,
});

describe("repairQuizJsonNode i18n", () => {
  it("keeps the historical Chinese messages by default", () => {
    const { issues } = repairQuizJsonNode(dirtyQuiz());
    const messages = issues.map((issue) => issue.message);
    expect(messages).toContain("已将 time_limit_seconds=90 换算为 time_limit_minutes=1.5");
    expect(messages).toContain("已移除未声明字段 bogus_key");
  });

  it("localizes messages while keeping paths and actions identical", () => {
    const zh = repairQuizJsonNode(dirtyQuiz());
    const en = repairQuizJsonNode(dirtyQuiz(), "root.quiz", "en");
    expect(en.issues.map((issue) => issue.path)).toEqual(zh.issues.map((issue) => issue.path));
    expect(en.issues.map((issue) => issue.action)).toEqual(zh.issues.map((issue) => issue.action));
    const enMessages = en.issues.map((issue) => issue.message);
    expect(enMessages).toContain("Converted time_limit_seconds=90 to time_limit_minutes=1.5");
    expect(enMessages).toContain("Removed undeclared field bogus_key");
  });
});

describe("loadSceneTolerantly i18n", () => {
  it("localizes the strict-parse-failure notice", () => {
    const zh = loadSceneTolerantly({});
    const en = loadSceneTolerantly({}, "en");
    expect(zh.usedLenientParse).toBe(true);
    expect(zh.parseIssues[0]?.message ?? "").toMatch(/^严格解析失败，已尝试宽松加载：/);
    expect(en.parseIssues[0]?.message ?? "").toMatch(/^Strict parsing failed; loaded leniently: /);
  });
});
