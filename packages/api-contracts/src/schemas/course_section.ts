// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Course section domain schemas.
 *
 * - Response side: TS interfaces (datetimes converted to toPythonIso strings at construction)
 * - Request side: zod (runtime validation; production's lax semantics bridged through helpers)
 * - Start/deadline condition validation has two branches (following production's split):
 *   the ValueError branch (condition absent but value/timezone given) lives in zod superRefine
 *   → 422; the APIException branch (INVALID_SECTION_CONDITION 403008) lives in
 *   assertSectionConditionPayloads — production raises APIException in that branch,
 *   straight through the validation layer; the TS route handler reproduces it by calling it after body validation
 */

import { z } from "zod";
import {
  CourseSectionStatus,
  CourseSectionType,
} from "../enums/course_section.ts";
import { HomeworkStatus } from "../enums/homework.ts";
import {
  SectionDeadlineCondition,
  SectionStartCondition,
} from "../enums/section_condition.ts";
import { ApiError, ErrorCode } from "../core/errors.ts";
import { isValidTimeZone } from "../utils/zoned_time.ts";
import { PaginationRequestSchema } from "./user.ts";
import { pyBool, pyEnum, pyUuidParam } from "./helpers.ts";
import {
  LiveClassroomCreateRequestSchema,
  LiveClassroomUpdateRequestSchema,
} from "./live_classroom.ts";
import type { TeacherInfo } from "./user.ts";
import type { AITeacherInfo } from "./ai_teacher.ts";
import type { LiveClassroomInfo } from "./live_classroom.ts";
import type { StudentInfo } from "./user.ts";
import type { CourseKnowledgeFileInfo } from "./course_knowledge_file.ts";
import type { InteractionSectionResponse } from "./interaction_section.ts";

/** Non-Optional bool (body: null refused, "true"/1 accepted leniently) */
const pyBoolRequired = z.preprocess(
  (value) => {
    if (typeof value === "string") {
      const lowered = value.toLowerCase();
      if (["true", "1", "yes", "on"].includes(lowered)) {
        return true;
      }
      if (["false", "0", "no", "off"].includes(lowered)) {
        return false;
      }
    }
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
    return value;
  },
  z.boolean(),
);

// ---------------------------------------------------------------------------
// Learning progress (CourseSectionLearningProgressInfo)
// ---------------------------------------------------------------------------

/** Section learning progress (filled per target student by tree/detail) */
export interface CourseSectionLearningProgressInfo {
  /** Learning progress 0-100 */
  learning_progress: number;
  learning_finished: boolean;
  attendance_status: boolean;
  homework_status: HomeworkStatus;
  attendanced_at: string | null;
  learning_finished_at: string | null;
  homework_submitted_at: string | null;
}

// ---------------------------------------------------------------------------
// Section info (CourseSectionInfo)
// ---------------------------------------------------------------------------

/** Course section info (the form embedded in tree nodes) */
export interface CourseSectionInfo {
  created_by: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;

  section_id: string;
  section_name: string;
  section_status: CourseSectionStatus;
  section_type: CourseSectionType;
  section_description: string | null;
  main_image_url: string | null;
  section_price: number | null;
  section_original_price: number | null;
  /** Interaction section (filled by the detail route; always null in the tree) */
  interaction_sections: InteractionSectionResponse[] | null;
  teacher_id: string | null;
  course_id: string;
  chapter_id: string;
  org_id: string;
  remark: string | null;
  /** Trial section flag */
  is_trial: boolean;
  /** Whether an AI courseware is bound */
  has_courseware_bound: boolean;
  /** Whether the current user may access it */
  can_access: boolean;
  // ---- Start/deadline conditions ----
  start_condition: SectionStartCondition | null;
  start_condition_value: string | null;
  start_condition_timezone: string | null;
  deadline_condition: SectionDeadlineCondition | null;
  deadline_condition_value: string | null;
  deadline_condition_timezone: string | null;
  // ---- Lock/expiry state computed per student ----
  locked: boolean;
  expired: boolean;
  unlock_at: string | null;
  deadline_at: string | null;

  sort: number | null;
  published_by: string | null;
  published_at: string | null;
  /** Teacher (human or AI) */
  teacher: TeacherInfo | AITeacherInfo | null;
  /** Live classroom (filled for Live sections) */
  live_classroom: LiveClassroomInfo | null;
  /** Video source (filled in the detail of Video sections; always null in the tree) */
  video_sources: CourseSectionVideoSourceInfo[] | null;
  /** Main teaching knowledge file (filled by the detail route; always null in the tree) */
  knowledge_file: CourseKnowledgeFileInfo | null;
  /** Learning progress */
  learning_progress: CourseSectionLearningProgressInfo | null;
}

// ---------------------------------------------------------------------------
// Interaction stats (StudentInteractionStatistics /
// CourseSectionInteractionStatisticsResponse)
// ---------------------------------------------------------------------------

/** Interaction stats for one student */
export interface StudentInteractionStatistics {
  student: StudentInfo;
  /** Total score of answered questions (null while there is no scoring record yet) */
  total_score: number | null;
  /** Total time spent on answered questions (seconds) */
  total_time_cost: number | null;
  answered_questions: number;
}

/** Interaction stats (aggregated at section/chapter/course level) */
export interface CourseSectionInteractionStatisticsResponse {
  /** null when aggregated at chapter/course level */
  section_id: string | null;
  course_id: string;
  /** null when aggregated at course level */
  chapter_id: string | null;
  total_questions: number;
  students: StudentInteractionStatistics[];
}

// ---------------------------------------------------------------------------
// Courseware quiz stats (the stats part)
// ---------------------------------------------------------------------------

/** Courseware quiz stats for one student */
export interface StudentCoursewareQuizStatistics {
  student_id: string;
  total_score: number;
  max_score: number;
  answered_questions: number;
  total_questions: number;
}

/** Courseware quiz stats (aggregate parallel to statistics/interaction) */
export interface CourseSectionCoursewareQuizStatisticsResponse {
  section_id: string | null;
  course_id: string;
  chapter_id: string | null;
  total_questions: number;
  students: StudentCoursewareQuizStatistics[];
}

// ---------------------------------------------------------------------------
// Today's classes
// ---------------------------------------------------------------------------

/** One upcoming live section in the home page's "Today's classes" */
export interface TeachingUpcomingLiveSectionItem {
  org_id: string;
  course_id: string;
  course_name: string;
  chapter_id: string;
  section_id: string;
  section_name: string;
  teacher_id: string | null;
  live_classroom: LiveClassroomInfo;
  can_join_live: boolean;
  /** Enrolled student count of the course (the intent card's "N people") */
  student_count: number;
}

/** "Today's classes" response */
export interface TeachingUpcomingLiveSectionsResponse {
  items: TeachingUpcomingLiveSectionItem[];
}

// ---------------------------------------------------------------------------
// Video source / attendance / completion rate / heatmap
// ---------------------------------------------------------------------------

/** Section video source (Video sections; file_url is a presigned URL) */
export interface CourseSectionVideoSourceInfo {
  file_id: string;
  file_name: string;
  file_url: string;
  /** Mainland-route ESA TypeC playback URL (null when no CDN is configured) */
  cdn_playback_url: string | null;
  sort: number | null;
  duration_seconds: number | null;
}

/** Section attendance summary (attending students and rate; only Live sections have attendance semantics) */
export interface CourseSectionAttendanceResponse {
  section_id: string;
  course_id: string;
  chapter_id: string;
  total_students: number;
  attended_students_count: number;
  absent_students_count: number;
  attendance_rate: number;
  attended_students: StudentInfo[];
  absent_students: StudentInfo[];
}

/** Completion rate stats for one video */
export interface VideoFinishRateByFileResponse {
  section_id: string;
  course_id: string;
  chapter_id: string;
  file_id: string;
  total_students: number;
  finished_students_count: number;
  unfinished_students_count: number;
  finish_rate: number;
  finished_students: StudentInfo[];
  unfinished_students: StudentInfo[];
}

/** One heatmap cell (time range + play rate) */
export interface VideoHeatmapItem {
  /** Time range string (e.g. '00:00 - 05:00') */
  time: string;
  /** Play rate = total watch time / (total students × range length) */
  play_rate: number;
}

/** Heatmap stats for one video */
export interface VideoHeatmapByFileResponse {
  section_id: string;
  course_id: string;
  chapter_id: string;
  file_id: string;
  total_students: number;
  average_watch_duration: number;
  video_duration: number;
  heatmap: VideoHeatmapItem[];
}

// ---------------------------------------------------------------------------
// Transcript items (TranscriptItem*; used by the teaching routes)
// ---------------------------------------------------------------------------

/** Transcript item content */
export interface CourseSectionTranscriptItemContent {
  id: string;
  text: string;
  order: number;
  section: string;
}

/** Transcript item (per slide) */
export interface CourseSectionTranscriptItem {
  slide_id: string;
  slide_title: string;
  order: number;
  content: CourseSectionTranscriptItemContent[];
  file_type: string;
  file_url: string | null;
  file_id: string | null;
  page_number: number | null;
}

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

/** Section list query */
export const CourseSectionListRequestSchema = PaginationRequestSchema.extend({
  section_name: z.string().optional().nullable(),
  section_status: pyEnum(Object.values(CourseSectionStatus)).optional().nullable(),
  /** Comma-separated statuses (invalid values silently dropped) */
  section_statuses: z.string().optional().nullable(),
  section_type: pyEnum(Object.values(CourseSectionType)).optional().nullable(),
  remark: z.string().optional().nullable(),
});

export type CourseSectionListRequest = z.infer<typeof CourseSectionListRequestSchema>;

/** ISO date string (YYYY-MM-DD, a real calendar day) */
function isIsoDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const year = Number.parseInt(value.slice(0, 4), 10);
  const month = Number.parseInt(value.slice(5, 7), 10);
  const day = Number.parseInt(value.slice(8, 10), 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

/**
 * ValueError branch (→ 422): condition absent but value/timezone provided.
 * In production a model-level validator's ValueError is wrapped into a ValidationError.
 */
function refineConditionPair(
  ctx: z.RefinementCtx,
  label: "start_condition" | "deadline_condition",
  condition: string | null | undefined,
  value: string | null | undefined,
  timezoneValue: string | null | undefined,
): void {
  if (condition === null || condition === undefined) {
    if (
      (value !== null && value !== undefined) ||
      (timezoneValue !== null && timezoneValue !== undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["body"],
        message: `${label} must be provided when updating ${label}_value or ${label}_timezone`,
      });
    }
  }
}

/**
 * APIException branch (→ 403008 INVALID_SECTION_CONDITION):
 * validation of condition combined with value/timezone. Production raises APIException inside the validator,
 * straight through the validation layer; on the TS side the handler calls this function after body validation passes
 * (the observable order matches: field 422s come before this check).
 */
export function assertSectionConditionPayload(
  condition: string | null | undefined,
  value: string | null | undefined,
  timezoneValue: string | null | undefined,
  fieldLabel: string,
): void {
  if (condition === null || condition === undefined) {
    return;
  }
  if (condition === "none" || condition === "after_previous_completed") {
    if (value !== null && value !== undefined) {
      throw new ApiError(
        ErrorCode.INVALID_SECTION_CONDITION,
        `${fieldLabel}_value must be None when ${fieldLabel} is '${condition}'`,
      );
    }
  } else if (condition === "days_after_previous_completed") {
    if (value === null || value === undefined) {
      throw new ApiError(
        ErrorCode.INVALID_SECTION_CONDITION,
        `${fieldLabel}_value is required when ${fieldLabel} is 'days_after_previous_completed'`,
      );
    }
    const days = Number(value);
    if (!Number.isInteger(days) || days <= 0) {
      throw new ApiError(
        ErrorCode.INVALID_SECTION_CONDITION,
        `${fieldLabel}_value must be a positive integer string for 'days_after_previous_completed', got '${value}'`,
      );
    }
  } else if (condition === "fixed_date") {
    if (value === null || value === undefined) {
      throw new ApiError(
        ErrorCode.INVALID_SECTION_CONDITION,
        `${fieldLabel}_value is required when ${fieldLabel} is 'fixed_date'`,
      );
    }
    if (!isIsoDateString(value)) {
      throw new ApiError(
        ErrorCode.INVALID_SECTION_CONDITION,
        `${fieldLabel}_value must be a valid ISO date string for 'fixed_date', got '${value}'`,
      );
    }
  }

  // timezone metadata validation (only fixed_date may carry it)
  if (condition !== "fixed_date") {
    if (timezoneValue !== null && timezoneValue !== undefined) {
      throw new ApiError(
        ErrorCode.INVALID_SECTION_CONDITION,
        `${fieldLabel}_timezone must be None when ${fieldLabel} is '${condition}'`,
      );
    }
    return;
  }
  if (timezoneValue !== null && timezoneValue !== undefined && !isValidTimeZone(timezoneValue)) {
    throw new ApiError(
      ErrorCode.INVALID_SECTION_CONDITION,
      `${fieldLabel}_timezone must be a valid IANA timezone, got '${timezoneValue}'`,
    );
  }
}

/** Condition combination assertion shared by create/update (start + deadline) */
export function assertSectionConditionPayloads(data: {
  start_condition?: string | null;
  start_condition_value?: string | null;
  start_condition_timezone?: string | null;
  deadline_condition?: string | null;
  deadline_condition_value?: string | null;
  deadline_condition_timezone?: string | null;
}): void {
  assertSectionConditionPayload(
    data.start_condition,
    data.start_condition_value,
    data.start_condition_timezone,
    "start_condition",
  );
  assertSectionConditionPayload(
    data.deadline_condition,
    data.deadline_condition_value,
    data.deadline_condition_timezone,
    "deadline_condition",
  );
}

/** Create a section */
export const CourseSectionCreateRequestSchema = z
  .object({
    section_name: z.string().min(1).max(100),
    section_status: pyEnum(Object.values(CourseSectionStatus)),
    section_description: z.string().max(1000).optional().nullable(),
    section_type: pyEnum(Object.values(CourseSectionType)),
    main_image_url: z.string().max(500).optional().nullable(),
    section_price: z.number().min(0).optional().nullable(),
    section_original_price: z.number().min(0).optional().nullable(),
    teacher_id: pyUuidParam.optional().nullable(),
    remark: z.string().max(500).optional().nullable(),
    /** Trial section (free preview without enrolling) */
    is_trial: pyBool().optional().nullable(),
    start_condition: pyEnum(Object.values(SectionStartCondition)).optional().nullable(),
    start_condition_value: z.string().optional().nullable(),
    start_condition_timezone: z.string().optional().nullable(),
    deadline_condition: pyEnum(Object.values(SectionDeadlineCondition)).optional().nullable(),
    deadline_condition_value: z.string().optional().nullable(),
    deadline_condition_timezone: z.string().optional().nullable(),
    sort: z.number().int().min(0).optional().nullable().default(0),
    /** Live classroom config (Live sections only) */
    live_classroom: LiveClassroomCreateRequestSchema.nullable().optional(),
  })
  .superRefine((data, ctx) => {
    refineConditionPair(ctx, "start_condition", data.start_condition, data.start_condition_value, data.start_condition_timezone);
    refineConditionPair(ctx, "deadline_condition", data.deadline_condition, data.deadline_condition_value, data.deadline_condition_timezone);
  });

export type CourseSectionCreateRequest = z.infer<typeof CourseSectionCreateRequestSchema>;

/** Update a section (None = not updated; has_courseware_bound cannot be changed through this endpoint) */
export const CourseSectionUpdateRequestSchema = z
  .object({
    section_name: z.string().min(1).max(100).optional().nullable(),
    section_status: pyEnum(Object.values(CourseSectionStatus)).optional().nullable(),
    section_description: z.string().max(1000).optional().nullable(),
    section_type: pyEnum(Object.values(CourseSectionType)).optional().nullable(),
    main_image_url: z.string().max(500).optional().nullable(),
    section_price: z.number().min(0).optional().nullable(),
    section_original_price: z.number().min(0).optional().nullable(),
    teacher_id: pyUuidParam.optional().nullable(),
    remark: z.string().max(500).optional().nullable(),
    is_trial: pyBool().optional().nullable(),
    start_condition: pyEnum(Object.values(SectionStartCondition)).optional().nullable(),
    start_condition_value: z.string().optional().nullable(),
    start_condition_timezone: z.string().optional().nullable(),
    deadline_condition: pyEnum(Object.values(SectionDeadlineCondition)).optional().nullable(),
    deadline_condition_value: z.string().optional().nullable(),
    deadline_condition_timezone: z.string().optional().nullable(),
    sort: z.number().int().min(0).optional().nullable(),
    live_classroom: LiveClassroomUpdateRequestSchema.nullable().optional(),
  })
  .superRefine((data, ctx) => {
    refineConditionPair(ctx, "start_condition", data.start_condition, data.start_condition_value, data.start_condition_timezone);
    refineConditionPair(ctx, "deadline_condition", data.deadline_condition, data.deadline_condition_value, data.deadline_condition_timezone);
  });

export type CourseSectionUpdateRequest = z.infer<typeof CourseSectionUpdateRequestSchema>;

/** Set the courseware-bound flag */
export const CourseSectionSetCoursewareBoundRequestSchema = z.object({
  has_courseware_bound: pyBoolRequired,
});

export type CourseSectionSetCoursewareBoundRequest = z.infer<
  typeof CourseSectionSetCoursewareBoundRequestSchema
>;

/** Push learning progress */
export const CourseSectionPushLearningProgressRequestSchema = z.object({
  /** Learning progress 0-100 */
  learning_progress: z.coerce.number().int().min(0).max(100),
  /** Time spent on courseware pages (key-value pairs; the server merges them with existing values) */
  slides_page_times: z.record(z.string(), z.coerce.number().int()).optional().nullable(),
});

export type CourseSectionPushLearningProgressRequest = z.infer<
  typeof CourseSectionPushLearningProgressRequestSchema
>;

/** AI classroom attendance record report */
export const AICourseRecordingPublishRequestSchema = z.object({
  attendanced_at: z.string().datetime({ offset: true }),
  leaved_at: z.string().datetime({ offset: true }),
  learning_finished_at: z.string().datetime({ offset: true }).optional().nullable(),
});

export type AICourseRecordingPublishRequest = z.infer<typeof AICourseRecordingPublishRequestSchema>;

/** One video watch record (exactly one of file_id and recording_id) */
export const VideoWatchRecordingPublishRequestSchema = z
  .object({
    file_id: pyUuidParam.optional().nullable(),
    recording_id: pyUuidParam.optional().nullable(),
    start_time: z.number().min(0),
    end_time: z.number().min(0),
  })
  .superRefine((data, ctx) => {
    if ((data.file_id === null || data.file_id === undefined) === (data.recording_id === null || data.recording_id === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["body"],
        message: "Exactly one of file_id or recording_id must be provided",
      });
    }
  });

export type VideoWatchRecordingPublishRequest = z.infer<typeof VideoWatchRecordingPublishRequestSchema>;

/** Bulk video watch record report */
export const VideoWatchRecordingBatchPublishRequestSchema = z.object({
  recordings: z.array(VideoWatchRecordingPublishRequestSchema).min(1, "List should have at least 1 item after validation, not 0"),
});

export type VideoWatchRecordingBatchPublishRequest = z.infer<
  typeof VideoWatchRecordingBatchPublishRequestSchema
>;

/** Bind a knowledge file */
export const CourseSectionAssociateKnowledgeFilesRequestSchema = z.object({
  file_ids: z.array(pyUuidParam).min(1, "List should have at least 1 item after validation, not 0"),
});

export type CourseSectionAssociateKnowledgeFilesRequest = z.infer<
  typeof CourseSectionAssociateKnowledgeFilesRequestSchema
>;

/** Unbind a knowledge file */
export const CourseSectionDisassociateKnowledgeFilesRequestSchema = z.object({
  file_ids: z.array(pyUuidParam).min(1, "List should have at least 1 item after validation, not 0"),
});

export type CourseSectionDisassociateKnowledgeFilesRequest = z.infer<
  typeof CourseSectionDisassociateKnowledgeFilesRequestSchema
>;

/** Move a section to another chapter */
export const CourseSectionMoveRequestSchema = z.object({
  to_chapter_id: pyUuidParam,
  /** Position within the target chapter; omitted = append at the end */
  to_sort: z.number().int().min(0).optional().nullable(),
});

export type CourseSectionMoveRequest = z.infer<typeof CourseSectionMoveRequestSchema>;

/** Target chapter of a drag reorder (section_ids is the chapter's complete final list) */
export const CourseSectionReorderTargetSchema = z.object({
  chapter_id: pyUuidParam,
  section_ids: z.array(pyUuidParam),
});

/** Drag reorder (supports moving across chapters) */
export const CourseSectionReorderRequestSchema = z.object({
  targets: z.array(CourseSectionReorderTargetSchema).min(1, "List should have at least 1 item after validation, not 0"),
});

export type CourseSectionReorderRequest = z.infer<typeof CourseSectionReorderRequestSchema>;

/** Video heatmap query */
export const VideoHeatmapRequestSchema = z.object({
  /** Time range in minutes (default 5) */
  interval_minutes: z.coerce.number().int().min(1).max(60).default(5),
});

export type VideoHeatmapRequest = z.infer<typeof VideoHeatmapRequestSchema>;

// ---------------------------------------------------------------------------
// Cross-course section copy
// ---------------------------------------------------------------------------

/** Reference to one source section (must be under source_chapter_id in the source course) */
export const DuplicateSectionRefSchema = z.object({
  source_chapter_id: pyUuidParam,
  section_id: pyUuidParam,
});

/** Copy sections from another course into this chapter */
export const DuplicateSectionsFromCourseRequestSchema = z.object({
  source_course_id: pyUuidParam,
  /** Copy these sections in the desired order */
  sections: z.array(DuplicateSectionRefSchema).min(1, "List should have at least 1 item after validation, not 0"),
  /** Insert after this section; null = append at the end */
  insert_after_section_id: pyUuidParam.optional().nullable(),
});

export type DuplicateSectionsFromCourseRequest = z.infer<
  typeof DuplicateSectionsFromCourseRequestSchema
>;
