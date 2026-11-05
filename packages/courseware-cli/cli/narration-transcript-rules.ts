// SPDX-License-Identifier: AGPL-3.0-only
import { AinobiCliError } from "./errors.ts";

/** Narration TTS / subtitle lines longer than this require at least one `\n` in the source. */
export const MAX_NARRATION_TTS_CHARS_WITHOUT_LINE_BREAK = 50;

/** Text used for TTS and (when transcript was omitted) stored `transcript`. */
export const resolveNarrationTtsSource = (script: string, transcript: string): string =>
  transcript.trim() === "" ? script : transcript;

/** Persisted narration.transcript: keep user transcript when set, else fall back to script. */
export const resolveNarrationTranscriptStored = (script: string, transcript: string): string =>
  transcript.trim() === "" ? script : transcript;

export const assertNarrationTtsLineBreakPolicy = (ttsSource: string): void => {
  const normalized = ttsSource.replace(/\r\n/g, "\n");
  if (normalized.includes("\n")) return;
  const text = normalized.trim();
  if (Array.from(text).length <= MAX_NARRATION_TTS_CHARS_WITHOUT_LINE_BREAK) return;
  throw new AinobiCliError(
    "USAGE",
    `Narration TTS source is longer than ${MAX_NARRATION_TTS_CHARS_WITHOUT_LINE_BREAK} characters without a line break. Split using \\n at phrase or sentence boundaries — not mid-clause wraps.`,
    {
      hint:
        "Pass --transcript with embedded newlines only where a line is a complete spoken unit (e.g. $'第一句。\\n第二句。'). " +
        "Do not break every comma or wrap for visual width; see design-excellence.md §6. " +
        "When --transcript is omitted, --script is used for synthesis.",
    },
  );
};
