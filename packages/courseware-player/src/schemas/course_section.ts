// SPDX-License-Identifier: AGPL-3.0-only
import type { InferType } from "yup";
import { array, boolean, date, mixed, number, object, string } from "yup";

import { CourseSectionType } from "@ainobi/api-contracts/enums/course_section.ts";
import { CourseKnowledgeFileType } from "@ainobi/api-contracts/enums/course_knowledge_file.ts";
import { CourseSectionStatus } from "@ainobi/api-contracts/enums/course_section.ts";
import { liveClassroomInfoSchema } from "./live_classroom.ts";
import { teacherInfoSchema, type TeacherInfo } from "./teacher.ts";
import { aiTeacherInfoSchema, type AITeacherInfo } from "./ai_teacher.ts";
import { courseKnowledgeFileInfoSchema, type CourseKnowledgeFileInfo } from "./course_knowledge_file.ts";

export const courseSectionTranscriptItemContentSchema = object({
  id: string().required(),
  text: string().required(),
  order: number().required(),
  section: string().required(),
});
export type CourseSectionTranscriptItemContent = InferType<
  typeof courseSectionTranscriptItemContentSchema
>;

export const courseSectionTranscriptItemSchema = object({
  slide_id: string().required(),
  slide_title: string().required(),
  order: number().required(),
  content: array(courseSectionTranscriptItemContentSchema).required(),
  file_type: string().oneOf(Object.values(CourseKnowledgeFileType)).required(),
  file_url: string().nullable(),
  file_id: string().nullable(),
  page_number: number().nullable(),
});
export type CourseSectionTranscriptItem = InferType<
  typeof courseSectionTranscriptItemSchema
>;

export const courseSectionInteractionContentElementSchema = object({
  type: string().required(),
  content: string().nullable(),
  url: string().nullable(),
  description: string().nullable(),
  order: number().nullable(),
  question_id: string().nullable(),
  question_type: string().nullable(),
  question_text: string().nullable(),
  options: array(mixed()).nullable(),
  score: number().nullable(),
  timeout: number().nullable(),
  is_multi_select: boolean().nullable(),
  question_images: array(string()).nullable(),
  question_audios: array(string()).nullable(),
  allow_resubmit: boolean().nullable(),
});
export type CourseSectionInteractionContentElement = InferType<
  typeof courseSectionInteractionContentElementSchema
>;

export const courseSectionInteractionQuestionOptionSchema = object({
  id: string().required(),
  text: string().required(),
});
export type CourseSectionInteractionQuestionOption = InferType<
  typeof courseSectionInteractionQuestionOptionSchema
>;

// Feedback of the submitted answer
export const submittedAnswerFeedbackSchema = object({
  is_correct: boolean().nullable(),
  selected_options: array(string()).nullable(),
  score: number().nullable(),
  max_score: number().nullable(),
  feedback: mixed().nullable(), // May be a string or an object { explanation, improvements, strengths }
  explanation: string().nullable(),
  improvements: array(string()).nullable(),
  strengths: array(string()).nullable(),
  confidence: number().nullable(),
  recognized_text: string().nullable(), // AI-recognized text (audio tasks)
  // Audio task specific fields
  pronunciation_accuracy: number().nullable(), // Pronunciation accuracy
  fluency: number().nullable(), // Fluency
  content_consistency: number().nullable(), // Content consistency
  overall_comments: string().nullable(), // Overall evaluation
  duration: number().nullable(), // Audio duration
});
export type SubmittedAnswerFeedback = InferType<typeof submittedAnswerFeedbackSchema>;

// The submitted answer
export const submittedAnswerSchema = object({
  id: string().uuid().required(),
  answer_content: mixed().nullable(), // { selected: string[] } | { text: string } | { audio: string, duration: number }
  score: number().nullable(),
  feedback: submittedAnswerFeedbackSchema.nullable(),
  submitted_at: string().nullable(), // ISO date string
  scored_at: string().nullable(), // ISO date string
});
export type SubmittedAnswer = InferType<typeof submittedAnswerSchema>;

export const courseSectionInteractionQuestionSchema = object({
  id: string().uuid().required(),
  interaction_section_id: string().uuid().required(),
  question_type: string().required(),
  question_text: string().nullable(),
  question_images: array(string()).nullable(),
  question_audios: array(string()).nullable(),
  options: array(courseSectionInteractionQuestionOptionSchema).nullable(),
  score: number().nullable(), // Question score
  timeout: number().nullable(), // Per-question timeout (seconds)
  allow_resubmit: boolean().nullable(), // Whether repeated submission is allowed
  order: number().nullable(),
  submitted_answer: submittedAnswerSchema.nullable(), // The submitted answer
  created_at: date().nullable(),
  updated_at: date().nullable(),
});
export type CourseSectionInteractionQuestion = InferType<
  typeof courseSectionInteractionQuestionSchema
>;

export const courseSectionInteractionSectionSchema = object({
  id: string().uuid().required(),
  course_section_id: string().uuid().required(),
  is_required: boolean().default(false),
  pass_score: number().nullable(),
  content_elements: array(courseSectionInteractionContentElementSchema).nullable(),
  order: number().nullable(),
  questions: array(courseSectionInteractionQuestionSchema).nullable(),
  created_at: date().nullable(),
  updated_at: date().nullable(),
});
export type CourseSectionInteractionSection = InferType<
  typeof courseSectionInteractionSectionSchema
>;

export const courseSectionLearningProgressInfoSchema = object({
  learning_progress: number().default(0),
  learning_finished: boolean().default(false),
  attendance_status: boolean().default(false),
  homework_status: string().default("not_submit"),
  attendanced_at: date().nullable(),
  learning_finished_at: date().nullable(),
  homework_submitted_at: date().nullable(),
});
export type CourseSectionLearningProgressInfo = InferType<
  typeof courseSectionLearningProgressInfoSchema
>;

export const courseSectionVideoSourceInfoSchema = object({
  file_id: string().uuid().required(),
  file_name: string().required(),
  file_url: string().required().url(),
  // CDN accelerated playback URL (ESA TypeC, mainland line; null when CDN disabled)
  cdn_playback_url: string().nullable().optional(),
  sort: number().nullable(),
  duration_seconds: number().min(0).nullable(),
});
export type CourseSectionVideoSourceInfo = InferType<
  typeof courseSectionVideoSourceInfoSchema
>;

export const courseSectionInfoSchema = object({
  section_id: string().uuid().required(),
  section_name: string().required(),
  section_status: string().oneOf(Object.values(CourseSectionStatus)).required(),
  section_description: string().nullable(),
  section_type: string().oneOf(Object.values(CourseSectionType)).required(),
  main_image_url: string().nullable(),
  section_price: number().nullable(),
  section_original_price: number().nullable(),
  teacher_id: string().uuid().nullable(),
  course_id: string().uuid().required(),
  chapter_id: string().uuid().required(),
  org_id: string().uuid().required(),
  remark: string().nullable(),
  is_trial: boolean().optional().default(false),
  has_courseware_bound: boolean().optional().default(false),
  can_access: boolean().optional().default(true),
  start_condition: string().nullable(),
  start_condition_value: string().nullable(),
  deadline_condition: string().nullable(),
  deadline_condition_value: string().nullable(),
  locked: boolean().default(false),
  expired: boolean().default(false),
  unlock_at: string().nullable(),
  deadline_at: string().nullable(),
  sort: number().nullable(),
  published_by: string().uuid().nullable(),
  published_at: date().nullable(),
  transcripts: array(courseSectionTranscriptItemSchema).nullable(),
  knowledge_file: courseKnowledgeFileInfoSchema.nullable(),
  interaction_sections: array(courseSectionInteractionSectionSchema).nullable(),
  teacher: mixed<TeacherInfo | AITeacherInfo>().nullable(),
  live_classroom: liveClassroomInfoSchema.nullable(),
  video_sources: array(courseSectionVideoSourceInfoSchema).nullable(),
  learning_progress: courseSectionLearningProgressInfoSchema.nullable(),
});
export type CourseSectionInfo = InferType<typeof courseSectionInfoSchema>;
