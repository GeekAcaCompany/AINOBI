// SPDX-License-Identifier: AGPL-3.0-only
import { requestPathname } from "../http/request.ts";

const QUIZ_ANSWER_RECORDING_UPLOAD_PREFIX = "/courseware/quiz_answer_recordings/upload";
const QUIZ_ANSWER_RECORDING_PRESIGN_PATH = "/courseware/quiz_answer_recordings/presign";

/** POST paths under `/courseware/quiz_answer_recordings/*` (upload + presign). */
export function isCoursewareQuizAnswerRecordingsPostPath(url: string | undefined): boolean {
  const p = requestPathname(url);
  return (
    p === `${QUIZ_ANSWER_RECORDING_UPLOAD_PREFIX}/init` ||
    p === `${QUIZ_ANSWER_RECORDING_UPLOAD_PREFIX}/chunk` ||
    p === `${QUIZ_ANSWER_RECORDING_UPLOAD_PREFIX}/complete` ||
    p === `${QUIZ_ANSWER_RECORDING_UPLOAD_PREFIX}/abort` ||
    p === QUIZ_ANSWER_RECORDING_PRESIGN_PATH
  );
}

export function isCoursewareQuizAnswerRecordingUploadStatusPath(url: string | undefined): boolean {
  return requestPathname(url) === `${QUIZ_ANSWER_RECORDING_UPLOAD_PREFIX}/status`;
}
