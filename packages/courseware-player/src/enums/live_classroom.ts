// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Live Classroom Status
 */
export enum LiveClassroomStatus {
    /** Scheduled */
    Scheduled = "scheduled",
    /** In Progress */
    InProgress = "in_progress",
    /** Completed */
    Completed = "completed",
    /** Cancelled */
    Cancelled = "cancelled",
}

/**
 * Live Classroom Schedule Type
 */
export enum LiveClassroomScheduleType {
    /** Daily */
    Daily = "daily",
    /** Weekly */
    Weekly = "weekly",
    /** Monthly */
    Monthly = "monthly",
    /** One-time */
    OneTime = "one_time",
}

/**
 * Runtime lifecycle status for a live section
 */
export enum LiveSectionStatus {
    Incoming = "incoming",
    Ongoing = "ongoing",
    Ended = "ended",
}

export enum LiveSectionRecordingStatus {
    None = "none",
    Processing = "processing",
    Ready = "ready",
}

/**
 * Course Section Live Classroom Meeting Role
 */
export enum LiveClassroomMeetingRole {
    /** Moderator */
    Moderator = "moderator",
    /** Participant */
    Participant = "participant",
}

/**
 * Live Classroom Recording Status
 */
export enum LiveClassroomRecordingStatus {
    /** Pending */
    Pending = "pending",
    /** Processing */
    Processing = "processing",
    /** Completed */
    Completed = "completed",
    /** Failed */
    Failed = "failed",
  }
  
