// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Live classroom domain request schemas and response DTOs.
 *
 * date/time are strings at the JSON boundary (the same format as pg date/time):
 * - date uses pyDate() from helpers: accepts YYYY-MM-DD and the truncated midnight datetime form
 *   ('2026-01-01T00:00:00' → '2026-01-01'), with speedate-style error text
 * - time uses the local pyTime: HH:MM[[:SS][.ffffff]][timezone suffix], seconds optional
 * - HttpUrl is approximated by z.string().url() (no host lowercasing / trailing-slash normalization)
 */

import { z } from "zod";
import {
  LiveClassroomRecordingStatus,
  LiveClassroomScheduleType,
  LiveClassroomStatus,
  type LiveClassroomMeetingRole,
  type LiveSectionRecordingStatus,
  type LiveSectionStatus,
} from "../enums/live_classroom.ts";
import { pyBool, pyDate, pyEnum, pyUuidParam } from "./helpers.ts";
import { PaginationRequestSchema } from "./user.ts";

/**
 * time value (time.fromisoformat's acceptance surface): HH:MM[[:SS][.ffffff]][timezone suffix].
 * Two-digit zero padding is required ("9:05" is refused); seconds are optional (console's time picker "14:16"
 * gets 00 appended); timezone suffixes Z/±HH[:MM] are accepted; datetime strings are refused.
 */
const PY_TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

function pyTimeOk(value: string): boolean {
  const match = PY_TIME_RE.exec(value);
  if (!match) {
    return false;
  }
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  const second = match[3] !== undefined ? Number.parseInt(match[3], 10) : 0;
  return hour <= 23 && minute <= 59 && second <= 59;
}

export const pyTime = z
  .string()
  .refine((value) => pyTimeOk(value), {
    message: "Input should be a valid time, unable to parse string as a time",
  });

/** Approximation of HttpUrl (scheme + host required) */
export const pyHttpUrl = z.string().url("Input should be a valid URL");

// ---------------------------------------------------------------------------
// LiveClassroomCreateRequest / LiveClassroomUpdateRequest (embedded in section create/update)
// ---------------------------------------------------------------------------

export const LiveClassroomCreateRequestSchema = z.object({
  classroom_name: z.string().min(2).max(256),
  classroom_status: pyEnum(Object.values(LiveClassroomStatus)).nullable().optional(),
  classroom_duration: z.coerce.number().int().min(0).nullable().optional(),
  start_date: pyDate().nullable().optional(),
  end_date: pyDate().nullable().optional(),
  start_time: pyTime.nullable().optional(),
  end_time: pyTime.nullable().optional(),
  timezone: z.string().min(1),
  schedule_type: pyEnum(Object.values(LiveClassroomScheduleType)).nullable().optional(),
  auto_record: pyBool().optional().default(true),
  max_participants: z.coerce.number().int().min(1).nullable().optional(),
  knowledge_file_id: pyUuidParam.nullable().optional(),
  third_party_meeting_url: pyHttpUrl.nullable().optional(),
});

export const LiveClassroomUpdateRequestSchema = z.object({
  classroom_name: z.string().min(1).max(100).nullable().optional(),
  classroom_status: pyEnum(Object.values(LiveClassroomStatus)).nullable().optional(),
  classroom_duration: z.coerce.number().int().min(0).nullable().optional(),
  start_date: pyDate().nullable().optional(),
  end_date: pyDate().nullable().optional(),
  start_time: pyTime.nullable().optional(),
  end_time: pyTime.nullable().optional(),
  timezone: z.string().min(1).nullable().optional(),
  schedule_type: pyEnum(Object.values(LiveClassroomScheduleType)).nullable().optional(),
  auto_record: pyBool().nullable().optional(),
  max_participants: z.coerce.number().int().min(1).nullable().optional(),
  knowledge_file_id: pyUuidParam.nullable().optional(),
  third_party_meeting_url: pyHttpUrl.nullable().optional(),
});

// ---------------------------------------------------------------------------
// Recording list / upload parameters / upload confirmation (mounted on the course_section routes)
// ---------------------------------------------------------------------------

export const LiveClassroomRecordingListRequestSchema = PaginationRequestSchema.extend({
  published: pyBool().nullable().optional(),
});

export const LiveClassroomRecordingUploadParamsRequestSchema = z.object({
  file_name: z.string().min(1).max(255),
  file_size: z.coerce.number().int().min(1),
  content_type: z.string(),
});

export const LiveClassroomRecordingConfirmUploadRequestSchema = z.object({
  recording_id: pyUuidParam,
  lock_id: pyUuidParam,
  file_path: z.string(),
  file_name: z.string().min(1).max(255),
  file_size: z.coerce.number().int().min(1),
  start_time: z.string().datetime({ offset: true }),
  end_time: z.string().datetime({ offset: true }),
});

export type LiveClassroomCreateRequest = z.infer<typeof LiveClassroomCreateRequestSchema>;
export type LiveClassroomUpdateRequest = z.infer<typeof LiveClassroomUpdateRequestSchema>;
export type LiveClassroomRecordingListRequest = z.infer<typeof LiveClassroomRecordingListRequestSchema>;
export type LiveClassroomRecordingUploadParamsRequest = z.infer<typeof LiveClassroomRecordingUploadParamsRequestSchema>;
export type LiveClassroomRecordingConfirmUploadRequest = z.infer<typeof LiveClassroomRecordingConfirmUploadRequestSchema>;

// ---------------------------------------------------------------------------
// LiveClassroomInfo (response DTO)
//
// date/time fields keep the pg string as-is (that is exactly date/time's isoformat output);
// datetimes go through toPythonIso.
// ---------------------------------------------------------------------------

/** Live classroom info (runtime fields live_status/can_join_live and recording aggregate counts) */
export interface LiveClassroomInfo {
  created_by: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;

  classroom_id: string;
  classroom_name: string;
  classroom_status: LiveClassroomStatus | null;
  classroom_duration: number | null;
  /** Start date (pg date, YYYY-MM-DD) */
  start_date: string | null;
  end_date: string | null;
  /** Start time (pg time, HH:MM:SS) */
  start_time: string | null;
  end_time: string | null;
  timezone: string | null;
  schedule_type: LiveClassroomScheduleType | null;
  last_class_time: string | null;
  auto_record: boolean | null;
  meeting_id: string | null;
  moderator_password: string | null;
  participant_password: string | null;
  max_participants: number | null;
  knowledge_file_id: string | null;
  third_party_meeting_url: string | null;

  // ---- Runtime/aggregate derived fields ----
  live_status: LiveSectionStatus | null;
  can_join_live: boolean | null;
  recording_status: LiveSectionRecordingStatus;
  uploaded_recording_count: number;
  published_recording_count: number;
  has_published_live_recording: boolean;
}

// ---------------------------------------------------------------------------
// Recording detail and join URL response DTOs
// ---------------------------------------------------------------------------

/** Live classroom recording info (BaseInfo fields first; storaged_playback_size_bytes is not a response field — ignored as an extra payload key) */
export interface LiveClassroomRecordingInfo {
  created_by: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;

  recording_id: string;
  recording_name: string;
  recording_status: LiveClassroomRecordingStatus;
  playback_url: string | null;
  storaged_playback_url: string | null;
  /** ESA edge acceleration URL (null when RECORDING_CDN_BASE_URL is not configured) */
  cdn_playback_url: string | null;
  start_time: string | null;
  end_time: string | null;
  meeting_id: string | null;
  internal_meeting_id: string | null;
  published: boolean | null;
  published_by: string | null;
  published_at: string | null;
}

/** Response of generating a live join short link */
export interface LiveClassroomJoinUrlInfoResponse {
  join_url: string;
}

/** Response of joining a live classroom (message_code drives frontend i18n) */
export interface LiveClassroomMeetingUrlInfoResponse {
  meeting_url: string;
  meeting_role: LiveClassroomMeetingRole;
  message_code: string;
}

/** Presigned parameters for a manual recording upload */
export interface LiveClassroomRecordingUploadParamsResponse {
  upload_url: string;
  method: string;
  file_path: string;
  recording_id: string;
  lock_id: string;
  expires_at: string;
  fields: Record<string, unknown> | null;
  headers: Record<string, string> | null;
}
