// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Live classroom domain enums.
 */

/** Live classroom status (PG enum type: liveclassroomstatus) */
export const LiveClassroomStatus = {
  /** Scheduled */
  Scheduled: "scheduled",
  /** In progress */
  InProgress: "in_progress",
  /** Completed */
  Completed: "completed",
  /** Cancelled */
  Cancelled: "cancelled",
} as const;
export type LiveClassroomStatus =
  (typeof LiveClassroomStatus)[keyof typeof LiveClassroomStatus];

/** Live classroom schedule type (PG enum type: liveclassroomscheduletype) */
export const LiveClassroomScheduleType = {
  /** Daily */
  Daily: "daily",
  /** Weekly */
  Weekly: "weekly",
  /** Monthly */
  Monthly: "monthly",
  /** One-off */
  OneTime: "one_time",
} as const;
export type LiveClassroomScheduleType =
  (typeof LiveClassroomScheduleType)[keyof typeof LiveClassroomScheduleType];

/**
 * Live classroom meeting role for a course section
 *
 * The BBB meeting moderator / participant roles; no matching PG enum type.
 */
export const LiveClassroomMeetingRole = {
  /** Moderator */
  Moderator: "moderator",
  /** Participant */
  Participant: "participant",
} as const;
export type LiveClassroomMeetingRole =
  (typeof LiveClassroomMeetingRole)[keyof typeof LiveClassroomMeetingRole];

/** Runtime lifecycle status of a live section (derived at runtime, no matching PG enum type) */
export const LiveSectionStatus = {
  Incoming: "incoming",
  Ongoing: "ongoing",
  Ended: "ended",
} as const;
export type LiveSectionStatus = (typeof LiveSectionStatus)[keyof typeof LiveSectionStatus];

/** Aggregate recording availability of a live section (derived at runtime, no matching PG enum type) */
export const LiveSectionRecordingStatus = {
  /**
   * No recording. The member name None_ is a historical escaped name, kept as-is so production stays traceable.
   */
  None_: "none",
  Processing: "processing",
  Ready: "ready",
} as const;
export type LiveSectionRecordingStatus =
  (typeof LiveSectionRecordingStatus)[keyof typeof LiveSectionRecordingStatus];

/** Live classroom recording status (PG enum type: liveclassroomrecordingstatus) */
export const LiveClassroomRecordingStatus = {
  /** Pending */
  Pending: "pending",
  /** Waiting for upload */
  WaitUpload: "wait_upload",
  /** Uploading */
  Uploading: "uploading",
  /** Completed */
  Completed: "completed",
  /** Failed */
  Failed: "failed",
} as const;
export type LiveClassroomRecordingStatus =
  (typeof LiveClassroomRecordingStatus)[keyof typeof LiveClassroomRecordingStatus];
