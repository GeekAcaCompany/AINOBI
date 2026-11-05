// SPDX-License-Identifier: AGPL-3.0-only
import type { InferType } from "yup";
import { boolean, date, number, object, string } from "yup";

import {
  LiveClassroomRecordingStatus,
  LiveClassroomScheduleType,
  LiveSectionRecordingStatus,
  LiveSectionStatus,
  LiveClassroomStatus,
} from "../enums/live_classroom.ts";

import { baseInfoSchema } from "@ainobi/web-kit/schemas/base";

/**
 * Live Classroom Info Schema
 */
export const liveClassroomInfoSchema = object({
  // Live Classroom ID
  classroom_id: string().uuid().required(),
  // Classroom Name
  classroom_name: string().min(1).max(100).required(),
  // Classroom Status
  classroom_status: string()
    .oneOf(Object.values(LiveClassroomStatus))
    .nullable(),
  // Classroom Duration (in minutes)
  classroom_duration: number().min(0).nullable(),
  // Start Date
  start_date: date().nullable(),
  // End Date
  end_date: date().nullable(),
  // Start Time
  start_time: string().nullable(),
  // End Time
  end_time: string().nullable(),
  // Timezone (e.g., 'Asia/Tokyo', 'Asia/Shanghai', 'UTC')
  timezone: string().nullable(),
  // Schedule Type
  schedule_type: string()
    .oneOf(Object.values(LiveClassroomScheduleType))
    .nullable(),
  // Last Class Time
  last_class_time: date().nullable(),
  // Auto Record
  auto_record: boolean().default(true).nullable(),
  // Meeting ID
  meeting_id: string().nullable(),
  // Moderator Password
  moderator_password: string().nullable(),
  // Participant Password
  participant_password: string().nullable(),
  // Max Participants
  max_participants: number().min(1).default(100).nullable(),
  // Runtime lifecycle status
  live_status: string().oneOf(Object.values(LiveSectionStatus)).nullable(),
  // Whether the join window is open
  can_join_live: boolean().nullable(),
  // Aggregated recording availability status
  recording_status: string()
    .oneOf(Object.values(LiveSectionRecordingStatus))
    .default(LiveSectionRecordingStatus.None)
    .required(),
  // Whether there is a published live recording
  has_published_live_recording: boolean().nullable(),
}).concat(baseInfoSchema);

export type LiveClassroomInfo = InferType<typeof liveClassroomInfoSchema>;

/**
 * Live Classroom Recording Info Schema
 */
export const liveClassroomRecordingInfoSchema = object({
  // Recording ID
  recording_id: string().uuid().required(),
  // Recording Name
  recording_name: string().required(),
  // Recording Status
  recording_status: string()
    .oneOf(Object.values(LiveClassroomRecordingStatus))
    .default(LiveClassroomRecordingStatus.Pending)
    .required(),
  // Recording Playback URL
  playback_url: string().nullable(),
  // Storaged Playback URL (presigned direct URL, international line)
  storaged_playback_url: string().nullable(),
  // CDN accelerated playback URL (ESA TypeC, mainland line; null when CDN disabled)
  cdn_playback_url: string().nullable().optional(),
  // Recording Start Time
  start_time: date().nullable(),
  // Recording End Time
  end_time: date().nullable(),
  // Recording Meeting ID
  meeting_id: string().nullable(),
  // Recording Internal Meeting ID
  internal_meeting_id: string().nullable(),
  // Published
  published: boolean().default(false).nullable(),
  // Published By
  published_by: string().uuid().nullable(),
  // Published At
  published_at: date().nullable(),
}).concat(baseInfoSchema);

export type LiveClassroomRecordingInfo = InferType<
  typeof liveClassroomRecordingInfoSchema
>;
