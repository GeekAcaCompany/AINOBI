// SPDX-License-Identifier: AGPL-3.0-only
import {
  uploadQuizAnswerRecordingChunked,
  type QuizAnswerRecordingUploadProgress,
} from "../lib/courseware/chunked-quiz-answer-recording-upload.ts";
import { translate, type SupportedLanguage } from "../lib/i18n/index.ts";

export type UploadQuizAnswerRecordingParams = {
  coursewareId: string;
  file: File;
  // Section the learner is viewing; admits enrolled non-members at the
  // courseware-service org guard (public-course external students, issue #825).
  sectionId?: string;
  sceneId?: string;
  questionWrapperId?: string;
  durationSec?: number;
  onProgress?: (progress: QuizAnswerRecordingUploadProgress) => void;
  signal?: AbortSignal;
  /** UI language for user-facing error messages. Defaults to "zh". */
  language?: SupportedLanguage;
};

export type UploadQuizAnswerRecordingResponse = {
  recordingId: string;
  file_path: string;
  file_url: string;
};

function requireCoursewareId(
  coursewareId: string | undefined | null,
  language: SupportedLanguage,
): string {
  const id = coursewareId?.trim();
  if (!id) {
    throw new Error(translate(language, "coursewarePreview.errors.missingCoursewareIdUpload"));
  }
  return id;
}

/**
 * Quiz shadowing/speech answer recordings: written to `courseware_quiz_answer_recordings`, kept apart from the editor asset library.
 * The org is resolved by the server from the courseware record; the client doesn't pass it.
 */
async function uploadQuizAnswerRecording(
  params: UploadQuizAnswerRecordingParams,
): Promise<UploadQuizAnswerRecordingResponse> {
  const language = params.language ?? "zh";
  const cwId = requireCoursewareId(params.coursewareId, language);
  const result = await uploadQuizAnswerRecordingChunked({
    coursewareId: cwId,
    file: params.file,
    sectionId: params.sectionId,
    sceneId: params.sceneId,
    questionWrapperId: params.questionWrapperId,
    durationSec: params.durationSec,
    onProgress: params.onProgress,
    signal: params.signal,
    language,
  });
  return {
    recordingId: result.recordingId,
    file_path: result.file_path,
    file_url: result.file_url,
  };
}

const coursewareQuizAnswerRecordingsApi = {
  uploadQuizAnswerRecording,
};

export default coursewareQuizAnswerRecordingsApi;
export type { QuizAnswerRecordingUploadProgress };
