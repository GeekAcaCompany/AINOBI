// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { SUPPORTED_LANGUAGES, translations } from "@ainobi/courseware-player/lib/i18n/index";
import {
  createDefaultQuestion,
  createDefaultQuizConfig,
  validateQuizConfig,
  validateQuizSlideBindings,
} from "@ainobi/courseware-core/quiz.ts";
import { quizValidationMessagesFor } from "./quiz-validation-i18n.ts";

const configWithAiScoredQuestions = () => {
  const config = createDefaultQuizConfig();
  const essay = createDefaultQuestion("essay", "en");
  const speech = createDefaultQuestion("speech", "en");
  if (essay.type === "essay") essay.grading_criteria = "";
  if (speech.type === "speech") speech.grading_criteria = "";
  config.questions = [essay, speech];
  return config;
};

const criteriaIssues = (config: ReturnType<typeof createDefaultQuizConfig>, language: "zh" | "en" | "ja" = "zh") =>
  validateQuizConfig(config, quizValidationMessagesFor(language)).filter((issue) => issue.path.endsWith(".grading_criteria"));

describe("validateQuizConfig message localization", () => {
  it("localizes to Chinese", () => {
    const issues = criteriaIssues(configWithAiScoredQuestions());
    expect(issues.map((i) => i.message)).toEqual([
      "第 1 题（问答）请填写评分要求（用于 AI 评判）",
      "第 2 题（语音）请填写评分要求（用于 AI 评判）",
    ]);
  });

  it("returns Japanese messages when language is ja", () => {
    const issues = criteriaIssues(configWithAiScoredQuestions(), "ja");
    expect(issues.map((i) => i.message)).toEqual([
      "第 1 問（記述式）：採点基準を入力してください（AI 採点に使用）",
      "第 2 問（音声問題）：採点基準を入力してください（AI 採点に使用）",
    ]);
  });

  it("returns English messages when language is en", () => {
    const issues = criteriaIssues(configWithAiScoredQuestions(), "en");
    expect(issues[0]?.message).toBe(
      "Question 1 (essay): please fill in the scoring criteria (used for AI scoring)",
    );
    expect(issues[1]?.message).toBe(
      "Question 2 (speech): please fill in the scoring criteria (used for AI scoring)",
    );
  });

  it("localizes slide-binding issues", () => {
    const config = createDefaultQuizConfig();
    const q = createDefaultQuestion("single_choice", "en");
    config.questions = [q];
    const zh = validateQuizSlideBindings(config, [], quizValidationMessagesFor("zh"));
    expect(zh[0]?.message ?? "").toMatch(/尚未插入到任何 slide/);
    const ja = validateQuizSlideBindings(config, [], quizValidationMessagesFor("ja"));
    expect(ja[0]?.message ?? "").toContain("はまだどのスライドにも配置されていません");
    expect(ja[0]?.message ?? "").toContain(q.question_id);
    expect(ja[0]?.message ?? "").toContain("--type single_choice");
  });

  it("every quizValidation key exists in all supported languages", () => {
    const keys = Object.keys(translations.zh).filter((key) =>
      key.startsWith("coursewareEditor.quizValidation."),
    );
    expect(keys.length).toBeGreaterThanOrEqual(23);
    for (const language of SUPPORTED_LANGUAGES) {
      for (const key of keys) {
        expect(
          (translations[language] as Record<string, string>)[key],
          `${language} missing ${key}`,
        ).toBeTruthy();
      }
    }
  });
});
