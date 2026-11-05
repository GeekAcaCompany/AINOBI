// SPDX-License-Identifier: AGPL-3.0-only
/**
 * User file domain enums.
 *
 * All three are stored as plain string columns of the user_file table (not PG enums).
 */

/** Source of a registered file (stored as a string in user_file) */
export const UserFileSource = {
  UserUpload: "user_upload",
  OrgUpload: "org_upload",
  QuizAudio: "quiz_audio",
  /**
   * Attachments the interaction service (student home agent context) uploaded to its OSS bucket,
   * registered here afterwards.
   */
  InteractionAttachment: "interaction_attachment",
} as const;
export type UserFileSource = (typeof UserFileSource)[keyof typeof UserFileSource];

/** Coarse file type bucket (stored as a string in user_file) */
export const UserFileType = {
  Audio: "audio",
  Image: "image",
  Document: "document",
  Other: "other",
} as const;
export type UserFileType = (typeof UserFileType)[keyof typeof UserFileType];

/** Lifecycle status of a registered file row (stored as a string in user_file) */
export const UserFileStatus = {
  Active: "active",
  Deleted: "deleted",
} as const;
export type UserFileStatus = (typeof UserFileStatus)[keyof typeof UserFileStatus];
