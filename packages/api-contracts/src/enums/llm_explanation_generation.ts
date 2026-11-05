// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LLM explanation generation domain enums.
 */

/** LLM explanation transcript status (PG enum type: llmexplanationtranscriptstatus) */
export const LLMExplanationTranscriptStatus = {
  Pending: "pending",
  Completed: "completed",
  Failed: "failed",
} as const;
export type LLMExplanationTranscriptStatus =
  (typeof LLMExplanationTranscriptStatus)[keyof typeof LLMExplanationTranscriptStatus];

/** LLM explanation TTS status (PG enum type: llmexplanationttsstatus) */
export const LLMExplanationTTSStatus = {
  Pending: "pending",
  Completed: "completed",
  Failed: "failed",
  Skipped: "skipped",
} as const;
export type LLMExplanationTTSStatus =
  (typeof LLMExplanationTTSStatus)[keyof typeof LLMExplanationTTSStatus];

/** LLM explanation job type (PG enum type: llmexplanationjobtype) */
export const LLMExplanationJobType = {
  Transcript: "transcript",
  TTS: "tts",
} as const;
export type LLMExplanationJobType =
  (typeof LLMExplanationJobType)[keyof typeof LLMExplanationJobType];

/** LLM explanation job status (PG enum type: llmexplanationjobstatus) */
export const LLMExplanationJobStatus = {
  Pending: "pending",
  Processing: "processing",
  Completed: "completed",
  Failed: "failed",
} as const;
export type LLMExplanationJobStatus =
  (typeof LLMExplanationJobStatus)[keyof typeof LLMExplanationJobStatus];
