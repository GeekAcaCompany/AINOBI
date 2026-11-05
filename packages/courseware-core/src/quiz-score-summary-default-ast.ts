// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Default starter `react_layout` AST for the quiz score-summary panel.
 *
 * When an agent customizes it, use interpolations such as `{$total_score}` / `{$grade_label}`; never hard-code the full score.
 * `position: absolute|fixed` is forbidden (the AST style sandbox refuses it).
 */

import type { ContentLanguage } from "./content-language.ts";
import type { QuizScoreSummaryAstNode, QuizScoreSummaryInterpKey } from "./quiz-score-summary-ast.ts";
import type { QuizScoreSummaryTag } from "./quiz-score-summary-ast.ts";

const t = (text: string): QuizScoreSummaryAstNode => ({ kind: "text", text });
const i = (key: QuizScoreSummaryInterpKey): QuizScoreSummaryAstNode => ({ kind: "interp", key });

const S = (rules: Record<string, string | number>): Record<string, string | number> => rules;

const e = (
  tag: QuizScoreSummaryTag,
  props: Record<string, string | number | boolean | Record<string, string | number>> = {},
  children: QuizScoreSummaryAstNode[] = [],
): QuizScoreSummaryAstNode => ({
  kind: "element",
  tag,
  props,
  children,
});

const SHELL_STYLE = S({
  display: "flex",
  flexDirection: "column",
  width: "100%",
  height: "100%",
  color: "#4a4a46",
  fontFamily: "system-ui, -apple-system, sans-serif",
  backgroundColor: "transparent",
});

const TITLE_STYLE = S({
  fontSize: 36,
  fontWeight: 600,
  lineHeight: 1.35,
  margin: 0,
  marginBottom: 8,
  color: "#4a4a46",
});

const LABEL_STYLE = S({
  margin: 0,
  fontSize: 17,
  color: "#6b6b65",
});

const BODY_TEXT_STYLE = S({
  fontSize: 18,
  lineHeight: 1.5,
  color: "#5c5c56",
});

const META_STYLE = S({
  margin: 0,
  marginTop: 4,
  fontSize: 17,
  color: "#6b6b65",
});

/**
 * Learner-visible copy of the default card, keyed by the courseware content language
 * (`scene.metadata.language`). zh keeps the historical CLI wording; en / ja mirror the
 * student editor's `coursewareEditor.quizTemplates.*` entries so both surfaces match.
 */
const SCORE_SUMMARY_DEFAULT_COPY: Record<
  ContentLanguage,
  {
    title: string;
    score: string;
    grade: string;
    completedPrefix: string;
    completedSeparator: string;
    completedSuffix: string;
  }
> = {
  zh: {
    title: "测验成绩",
    score: "得分",
    grade: "等级",
    completedPrefix: "已完成 ",
    completedSeparator: " / ",
    completedSuffix: " 题",
  },
  en: {
    title: "Quiz Results",
    score: "Score",
    grade: "Grade",
    completedPrefix: "Completed ",
    completedSeparator: " / ",
    completedSuffix: " question(s)",
  },
  ja: {
    title: "クイズ結果",
    score: "得点",
    grade: "評価",
    completedPrefix: "完了 ",
    completedSeparator: " / ",
    completedSuffix: " 問",
  },
};

/**
 * Default summary panel written to scene.quiz.score_summary.react_layout.
 * `language` selects the baked copy (zh / en / ja) — resolve it from the scene first,
 * there is no fallback.
 */
export const buildDefaultQuizScoreSummaryAst = (language: ContentLanguage): QuizScoreSummaryAstNode => {
  const copy = SCORE_SUMMARY_DEFAULT_COPY[language];
  return e(
    "QuizScoreSummaryContainer",
    { padding: 32, gap: 22, style: SHELL_STYLE },
    [
      e("h2", { style: TITLE_STYLE }, [t(copy.title)]),
      e("div", { style: S({ display: "flex", flexDirection: "column", gap: 8 }) }, [
        e("p", { style: LABEL_STYLE }, [t(copy.score)]),
        e("QuizTotalScore", { style: S({ fontSize: 40, fontWeight: 600, color: "#4a4a46" }) }, []),
      ]),
      e("div", { style: S({ display: "flex", flexDirection: "column", gap: 8 }) }, [
        e("p", { style: LABEL_STYLE }, [t(copy.grade)]),
        e(
          "QuizGradeLabel",
          { style: S({ fontSize: 30, fontWeight: 600, color: "#4a4a46" }) },
          [i("grade_label")],
        ),
        e("QuizGradeDescription", { style: BODY_TEXT_STYLE }, [i("grade_description")]),
      ]),
      e("p", { style: META_STYLE }, [
        t(copy.completedPrefix),
        i("answered_count"),
        t(copy.completedSeparator),
        i("question_count"),
        t(copy.completedSuffix),
      ]),
    ],
  );
};
