// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from "node:http";

import { z } from "zod";

import { requireRequestSession } from "../api-auth.ts";
import { canAccessOrgAsMember } from "../auth/ainobi-org-access.ts";
import { dataSource } from "../db/db.ts";
import { sendJsonWithCors } from "../http/cors.ts";
import { readJsonBody } from "../http/request.ts";
import { requestPathname } from "../http/request.ts";
import { CoursewareQuizAnswerRecording } from "../models/courseware-quiz-answer-recordings.ts";
import { quizAnswerRecordingToDto } from "./courseware-quiz-answer-recordings-service.ts";
import {
  handleCoursewareQuizAnswerRecordingUploadAbort,
  handleCoursewareQuizAnswerRecordingUploadChunk,
  handleCoursewareQuizAnswerRecordingUploadComplete,
  handleCoursewareQuizAnswerRecordingUploadInit,
} from "./courseware-quiz-answer-recordings-chunked-upload.ts";

export {
  isCoursewareQuizAnswerRecordingsPostPath,
  isCoursewareQuizAnswerRecordingUploadStatusPath,
} from "./courseware-quiz-answer-recordings-paths.ts";

const recordingPresignSchema = z.object({
  recordingId: z.uuid(),
});

/**
 * Chunked upload of quiz answer recordings: `/courseware/quiz_answer_recordings/upload/*`
 */
export async function handleCoursewareQuizAnswerRecordingsPost(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const pathname = requestPathname(req.url);
  if (pathname === "/courseware/quiz_answer_recordings/upload/init") {
    return handleCoursewareQuizAnswerRecordingUploadInit(req, res);
  }
  if (pathname === "/courseware/quiz_answer_recordings/upload/chunk") {
    return handleCoursewareQuizAnswerRecordingUploadChunk(req, res);
  }
  if (pathname === "/courseware/quiz_answer_recordings/upload/complete") {
    return handleCoursewareQuizAnswerRecordingUploadComplete(req, res);
  }
  if (pathname === "/courseware/quiz_answer_recordings/upload/abort") {
    return handleCoursewareQuizAnswerRecordingUploadAbort(req, res);
  }
  if (pathname === "/courseware/quiz_answer_recordings/presign") {
    return handleCoursewareQuizAnswerRecordingPresign(req, res);
  }
  sendJsonWithCors(res, 404, { ok: false, error: "Not found" });
}

/**
 * `POST /courseware/quiz_answer_recordings/presign` — fresh playback URL for an
 * existing recording. The platform persists only keys / signature-free URLs
 * (presigned URLs expire), so teacher-side review resolves the playable URL
 * here at display time. Any org member of the recording's org may read it.
 */
async function handleCoursewareQuizAnswerRecordingPresign(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const parsed = recordingPresignSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    sendJsonWithCors(res, 400, { ok: false, error: parsed.error.issues[0]?.message ?? "invalid body" });
    return;
  }
  const session = await requireRequestSession(req);
  const row = await dataSource.getRepository(CoursewareQuizAnswerRecording).findOne({
    where: { recordingId: parsed.data.recordingId },
  });
  if (!row) {
    sendJsonWithCors(res, 404, { ok: false, error: "Recording not found" });
    return;
  }
  if (!(await canAccessOrgAsMember(session, row.orgId))) {
    sendJsonWithCors(res, 403, { ok: false, error: "Permission denied" });
    return;
  }
  sendJsonWithCors(res, 200, { ok: true, recording: quizAnswerRecordingToDto(row) });
}
