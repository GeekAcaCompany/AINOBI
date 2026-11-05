// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Course knowledge-base file domain enums.
 */

/** Course knowledge-base file status (PG enum type: courseknowledgefilestatus) */
export const CourseKnowledgeFileStatus = {
  /** Processing */
  Processing: "processing",
  /** Active */
  Active: "active",
  /** Disabled */
  Inactive: "inactive",
  /** Deleted */
  Deleted: "deleted",
} as const;
export type CourseKnowledgeFileStatus =
  (typeof CourseKnowledgeFileStatus)[keyof typeof CourseKnowledgeFileStatus];

/** Course knowledge-base file type (PG enum type: courseknowledgefiletype) */
export const CourseKnowledgeFileType = {
  /** Image */
  Image: "image",
  /** Video */
  Video: "video",
  /** Audio */
  Audio: "audio",
  /** PDF document */
  Pdf: "pdf",
  /** Word document */
  Docx: "docx",
  /** Excel document */
  Excel: "excel",
  /** PPT document */
  Pptx: "pptx",
  /** HTML document */
  Html: "html",
  /** Text */
  Text: "text",
  /** PPTist (AI courseware) */
  Pptist: "pptist",
  /** Other */
  Other: "other",
} as const;
export type CourseKnowledgeFileType =
  (typeof CourseKnowledgeFileType)[keyof typeof CourseKnowledgeFileType];
