// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Re-exports the CLI's pure matching logic, so the service and the CLI don't drift apart with two implementations.
 */
export {
  AINOBI_TTS_JA_KANA_LINES_FILE_ENV,
  applyJapaneseKanaReplacements,
  applyPronunciationDict,
  buildMinimaxToneRules,
  foldFullWidthDigits,
  formatInlinePronunciation,
  formatMinimaxToneRule,
  normalizePronunciationMark,
  normalizePronunciationSourceKey,
  parseKanaLineRewritesJson,
  parsePronunciationDictJson,
  resolveKanaLineRewrite,
  shouldApplyMinimaxToneDict,
  shouldApplyPronunciationDict,
  splitPronunciationSyllables,
  type PronunciationDictEntry,
  type PronunciationDictLanguage,
} from "@ainobi/courseware-cli/cli/tts-pronunciation-apply.ts";
