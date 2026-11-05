// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "vitest";

import type { ContentLanguage } from "./content-language.ts";
import { validateQuizScoreSummaryAst } from "./quiz-score-summary-ast.ts";
import { buildDefaultQuizScoreSummaryAst } from "./quiz-score-summary-default-ast.ts";

const TITLES: Record<ContentLanguage, string> = {
  zh: "测验成绩",
  en: "Quiz Results",
  ja: "クイズ結果",
};

test("buildDefaultQuizScoreSummaryAst bakes the card copy in the content language", () => {
  for (const language of Object.keys(TITLES) as ContentLanguage[]) {
    const ast = buildDefaultQuizScoreSummaryAst(language);
    assert.deepEqual(validateQuizScoreSummaryAst(ast), [], language);
    const text = JSON.stringify(ast);
    assert.ok(text.includes(TITLES[language]), `${language}: title`);
    for (const [other, title] of Object.entries(TITLES)) {
      if (other !== language) {
        assert.ok(!text.includes(title), `${language}: must not contain the ${other} title`);
      }
    }
  }
});
