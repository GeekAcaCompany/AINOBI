// SPDX-License-Identifier: AGPL-3.0-only
import { translate, type SupportedLanguage, type TranslationKey } from "@ainobi/courseware-player/lib/i18n/index";
import type { QuizValidationMessages } from "@ainobi/courseware-core/quiz-validation-messages.ts";

/**
 * Editor-UI localization for the engine's quiz validation issues: each message key maps
 * onto `coursewareEditor.quizValidation.<key>` in the app's locale files.
 */
export const quizValidationMessagesFor =
  (language: SupportedLanguage): QuizValidationMessages =>
  (key, variables) =>
    translate(language, `coursewareEditor.quizValidation.${key}` as TranslationKey, variables);
