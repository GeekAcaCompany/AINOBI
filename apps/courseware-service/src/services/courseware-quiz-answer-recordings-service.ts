// SPDX-License-Identifier: AGPL-3.0-only
import type { CoursewareQuizAnswerRecording } from "../models/courseware-quiz-answer-recordings.ts";
import { refreshCoursewareRecordingFileUrlForResponse } from "./courseware-object-url-response.ts";

export function quizAnswerRecordingToDto(row: CoursewareQuizAnswerRecording) {
  return {
    recordingId: row.recordingId,
    orgId: row.orgId,
    coursewareId: row.coursewareId,
    userId: row.userId,
    sceneId: row.sceneId,
    questionWrapperId: row.questionWrapperId,
    fileName: row.fileName,
    fileSize: row.fileSize,
    contentType: row.contentType,
    contentMd5: row.contentMd5,
    filePath: row.filePath,
    // Fresh signature from the stored key — the column never carries one.
    fileUrl: refreshCoursewareRecordingFileUrlForResponse(row.fileUrl),
    durationSec: row.durationSec,
    createdAt: row.createdAt?.toISOString() ?? null,
  };
}
