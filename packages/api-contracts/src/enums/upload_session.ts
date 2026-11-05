// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Upload session domain enums.
 */

/** Upload session scene (PG enum type: uploadsessionscene) */
export const UploadSessionScene = {
  CourseKnowledgeFile: "course_knowledge_file",
  LiveClassroomRecording: "live_classroom_recording",
} as const;
export type UploadSessionScene =
  (typeof UploadSessionScene)[keyof typeof UploadSessionScene];

/** Upload session status (PG enum type: uploadsessionstatus) */
export const UploadSessionStatus = {
  Pending: "pending",
  Confirmed: "confirmed",
  Released: "released",
  Expired: "expired",
  Cleaned: "cleaned",
  Failed: "failed",
} as const;
export type UploadSessionStatus =
  (typeof UploadSessionStatus)[keyof typeof UploadSessionStatus];
