// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Numbers are always Arabic numerals: the agent used to write years/question numbers/levels as Chinese numerals "for TTS pronunciation"
 * (二零二六年, N二, 一番), but TTS (including the Japanese counter reading dictionary) reads Arabic numerals correctly.
 */
export const NUMBER_FORMAT_RULE =
  '**Numbers (hard rule):** Write every number with Arabic digits in all learner-visible text — slide copy, narration `--transcript` / `--script` (they are also the subtitles), quiz titles/options/explanations, design briefs, and chat replies. This covers dates, years, times, quantities, prices, percentages, scores, rankings, step/question/chapter numbers, and levels or codes (e.g. write `2026年4月1日`, `2026年`, `25%`, `N2`, `第3章`, `1番`, `Step 2` — never `二零二六年`, `二〇二六年`, `二十五`, `N二`, `一番`). ' +
  'Do **not** convert digits to Chinese/Japanese numerals or spelled-out words "so TTS reads them correctly": narration TTS already reads Arabic digits correctly in Chinese, Japanese and English (Japanese counters are handled by the host pronunciation dictionary). ' +
  'If a source document already spells numbers out for TTS, convert them back to digits. Keep numeral characters only when they are part of a fixed word, name or idiom (e.g. `一起`, `一些`, `三角形`, `一石二鳥`), or when the lesson itself teaches how numerals are read or written.';
