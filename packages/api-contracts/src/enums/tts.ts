// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TTS domain enums.
 */

/** TTS provider (PG enum type: ttsprovider) */
export const TTSProvider = {
  FishAudio: "fishaudio",
  MiniMax: "minimax",
  Google: "google",
} as const;
export type TTSProvider = (typeof TTSProvider)[keyof typeof TTSProvider];

/** TTS status (PG enum type: ttsstatus) */
export const TTSStatus = {
  Active: "active",
  Inactive: "inactive",
  Deleted: "deleted",
} as const;
export type TTSStatus = (typeof TTSStatus)[keyof typeof TTSStatus];

/** TTS language (tts_language is a plain string column, not a PG enum) */
export const TTSLanguage = {
  Chinese: "zh",
  Japanese: "ja",
  English: "en",
} as const;
export type TTSLanguage = (typeof TTSLanguage)[keyof typeof TTSLanguage];

/** TTS provider → available models */
export const TTSModelMap: Record<TTSProvider, string[]> = {
  [TTSProvider.FishAudio]: ["fishaudio", "S1", "s2.1-pro"],
  [TTSProvider.MiniMax]: ["speech-2.8-hd"],
  [TTSProvider.Google]: ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"],
};
