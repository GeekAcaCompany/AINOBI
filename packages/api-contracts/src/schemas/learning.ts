// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Learning record domain schemas
 * (the /learning and /organization/{org_id}/learning-progress route families).
 */

import { z } from "zod";
import { CourseSectionType } from "../enums/course_section.ts";
import { LiveSectionStatus } from "../enums/live_classroom.ts";
import { pyUuid } from "./helpers.ts";

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

/** Learning duration report (append-only log; keepalive case) */
export const PushLearningTimeRequestSchema = z.object({
  section_id: pyUuid,
  section_type: z.nativeEnum(CourseSectionType),
  learning_time_seconds: z.preprocess(
    (value) => (value === undefined ? undefined : Number(value)),
    z.number().int().min(1).max(86400),
  ),
});

export type PushLearningTimeRequest = z.infer<typeof PushLearningTimeRequestSchema>;

/** Complete one spaced review (advances next_review_at) */
export const CompleteSectionReviewRequestSchema = z.object({
  section_id: pyUuid,
  course_id: pyUuid.nullable().optional(),
  chapter_id: pyUuid.nullable().optional(),
  org_id: pyUuid.nullable().optional(),
});

export type CompleteSectionReviewRequest = z.infer<typeof CompleteSectionReviewRequestSchema>;

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

/** Consecutive learning days */
export interface ConsecutiveLearningDaysResponse {
  consecutive_days: number;
  checked_in_today: boolean;
}

/** Learning time for one day (minutes) */
export interface DailyLearningTime {
  date: string;
  minutes: number;
}

/** Learning duration (date range + per-day breakdown) */
export interface LearningDurationResponse {
  total_minutes: number;
  daily: DailyLearningTime[];
}

/** Completed sections (range + period-over-period delta) */
export interface CompletedSectionsResponse {
  completed_count: number;
  delta: number;
}

/** Today's focus-flow task item */
export interface TaskItem {
  section_id: string;
  section_name: string;
  section_type: string;
  course_id: string;
  course_name: string;
  chapter_id: string;
  org_id: string;
  is_overdue: boolean;
  is_urgent: boolean;
  is_completed: boolean;
  deadline_at: string | null;
  live_start_time: string | null;
  live_start_date: string | null;
  live_end_time: string | null;
  live_timezone: string | null;
  live_status: LiveSectionStatus | null;
  can_join_live: boolean | null;
  learning_progress: number;
}

/** Schedule event (live class / all-day task) */
export interface ScheduleEvent {
  section_id: string;
  section_name: string;
  section_type: string;
  course_id: string;
  course_name: string;
  chapter_id: string;
  org_id: string;
  start_time: string | null;
  end_time: string | null;
  live_status: LiveSectionStatus | null;
  can_join_live: boolean | null;
  is_all_day: boolean;
  is_completed: boolean;
}

/** Schedule marker for one day */
export interface ScheduleDay {
  date: string;
  has_schedule: boolean;
}

/** Weekly schedule data */
export interface ScheduleData {
  days: ScheduleDay[];
  events: Record<string, ScheduleEvent[]>;
}

/** Dashboard (merged tasks + schedule response) */
export interface DashboardDataResponse {
  tasks: TaskItem[];
  overdue_count: number;
  urgent_count: number;
  schedule: ScheduleData;
}

/** Teacher feedback item */
export interface FeedbackItem {
  feedback_id: string;
  course_name: string;
  reviewer_name: string | null;
  reviewer_avatar_url: string | null;
  reviewer_role: string;
  feedback_type: string;
  feedback_content: string;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

/** Teacher feedback list */
export interface FeedbackListResponse {
  feedbacks: FeedbackItem[];
  total_count: number;
}

/** In-progress course item */
export interface OngoingCourseItem {
  course_id: string;
  course_name: string;
  org_id: string;
  main_image_url: string | null;
  total_sections: number;
  completed_sections: number;
  progress: number;
  next_section_name: string | null;
  next_chapter_id: string | null;
  next_section_id: string | null;
}

/** In-progress course list */
export interface OngoingCoursesResponse {
  courses: OngoingCourseItem[];
  total_count: number;
}

/** Section due for review */
export interface PendingReviewSectionItem {
  course_id: string;
  course_name: string;
  org_id: string;
  chapter_id: string;
  section_id: string;
  section_name: string;
  next_review_at: string | null;
  review_count: number;
}

/** List of sections due for review */
export interface PendingReviewSectionsResponse {
  items: PendingReviewSectionItem[];
  total_count: number;
}

/** Result of completing a review */
export interface CompleteSectionReviewResponse {
  section_id: string;
  review_count: number;
  next_review_at: string | null;
  advanced: boolean;
}

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

/** My course progress item (lightweight aggregate for course cards) */
export interface CourseProgressItem {
  course_id: string;
  total_sections: number;
  completed_sections: number;
  progress: number;
  has_live_sections: boolean;
  has_ai_sections: boolean;
  is_live_now: boolean;
  has_accessible_sections: boolean;
  has_accessible_live_now: boolean;
}

/** My course progress list */
export interface MyCoursesProgressResponse {
  items: CourseProgressItem[];
}

/** Progress item of one student in a course */
export interface StudentProgressItem {
  user_id: string;
  student_id: string;
  completed_sections: number;
  progress: number;
}

/** Course student progress list */
export interface CourseStudentsProgressResponse {
  course_id: string;
  total_sections: number;
  items: StudentProgressItem[];
}
