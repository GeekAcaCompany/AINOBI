// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Question status
 */
export enum QuestionStatus {
  /** Enabled */
  ENABLED = "enabled",
  /** Disabled */
  DISABLED = "disabled",
  /** Draft */
  DRAFT = "draft",
}

/**
 * Question type
 */
export enum QuestionType {
  /** Choice question */
  CHOICE = "choice",
  /** Fill-in-the-blank question */
  FILL_IN_THE_BLANK = "fill_in_the_blank",
  /** Shadowing question */
  SHADOWING = "shadowing",
  /** Recording question */
  VOICE_RECORDING = "voice_recording",
  /** Q&A question */
  ESSAY = "essay",
  /** Mixed question */
  MIXED = "mixed",
}

/**
 * Component type
 */
export enum ComponentType {
  /** Text */
  TEXT = "text",
  /** Image */
  IMAGE = "image",
  /** Audio */
  AUDIO = "audio",
  /** Choice question */
  CHOICE = "choice",
  /** Fill-in-the-blank question */
  FILL_IN_THE_BLANK = "fill_in_the_blank",
  /** Shadowing question */
  SHADOWING = "shadowing",
  /** Recording question */
  VOICE_RECORDING = "voice_recording",
  /** Q&A question */
  ESSAY = "essay",
}
