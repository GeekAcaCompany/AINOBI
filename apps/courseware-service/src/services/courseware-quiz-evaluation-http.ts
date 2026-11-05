// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

import { sendJsonWithCors } from "../http/cors.ts";
import { readJsonBody, requestPathname } from "../http/request.ts";
import { requireRequestSession } from "../api-auth.ts";
import { canAccessCoursewareOrg, normalizeOrgId } from "../auth/ainobi-org-access.ts";
import { hasManageLoginPermission } from "../auth/ainobi-user-session.ts";
import {
  CoursewareOrgAccessError,
  loadCoursewareByIdWithRequestAccess,
  resolveRequestSectionId,
} from "./courseware-org-guard.ts";
import {
  completeCoursewareQuizAttempt,
  evaluateCoursewareQuizSubmission,
  listCoursewareQuizAnswers,
} from "./courseware-quiz-evaluation-service.ts";
import {
  isQuizScoringResubmitError,
  isWellFormedQuizFeedbackLanguageTag,
  normalizeQuizFeedbackLanguage,
  QUIZ_SCORING_RESUBMIT_MESSAGE,
} from "./courseware-quiz-ai-scoring.ts";

const quizAnswerSchema = z
  .object({
    skipped: z.boolean().optional(),
    selected_option_ids: z.array(z.string()).optional(),
    selected_option_indices: z.array(z.number().int().min(0)).optional(),
    values: z.array(z.string()).optional(),
    value_by_member_id: z.record(z.string(), z.string()).optional(),
    recording_member_id: z.string().nullable().optional(),
    recording_id: z.string().uuid().nullable().optional(),
    recording_file_path: z.string().nullable().optional(),
    recording_file_url: z.string().nullable().optional(),
    recording_duration_sec: z.number().min(0).nullable().optional(),
  })
  .strict();

/** Client feedback locale: reject malformed/injection payloads; drop unsupported tags. */
const quizFeedbackLanguageSchema = z
  .string()
  .min(1)
  .max(32)
  .superRefine((value, ctx) => {
    if (!isWellFormedQuizFeedbackLanguageTag(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid quiz feedback language",
      });
    }
  })
  .transform((value) => normalizeQuizFeedbackLanguage(value));

const evaluateBodySchema = z
  .object({
    courseware_id: z.string().min(1),
    org_id: z.string().uuid().optional(),
    course_id: z.string().uuid().optional(),
    section_id: z.string().uuid().optional(),
    scene_id: z.string().min(1).optional(),
    slide_element_id: z.string().min(1).optional(),
    question_id: z.string().min(1).optional(),
    question_wrapper_id: z.string().min(1),
    language: quizFeedbackLanguageSchema.optional(),
    question: z.unknown().optional(),
    attempt_session_id: z.string().uuid().optional(),
    submission_id: z.string().uuid().optional(),
    answer: quizAnswerSchema,
    quiz_total_required: z.number().int().min(0).optional(),
    required_question_wrapper_ids: z.array(z.string().min(1)).optional(),
  })
  .strict();

const completeBodySchema = z
  .object({
    courseware_id: z.string().min(1),
    attempt_session_id: z.string().uuid(),
  })
  .strict();

const answersQuerySchema = z.object({
  attempt_session_id: z.string().uuid().optional(),
  courseware_id: z.string().min(1).optional(),
  section_id: z.string().uuid().optional(),
});

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  sendJsonWithCors(res, status, payload);
}

function errorStatus(error: unknown): number {
  if (error instanceof z.ZodError) {
    return 400;
  }
  if (error instanceof CoursewareOrgAccessError) {
    return error.status;
  }
  if (!(error instanceof Error)) {
    return 500;
  }
  if (error.message === "Invalid JSON body") {
    return 400;
  }
  if (error.message === "Unauthorized") {
    return 401;
  }
  if (error.message.includes("not found")) {
    return 404;
  }
  if (
    error.message.includes("not belong") ||
    error.message.includes("not enabled") ||
    error.message.includes("not bound") ||
    error.message.includes("does not match") ||
    error.message.includes("does not allow") ||
    error.message.includes("do not meet") ||
    error.message.includes("already completed") ||
    error.message.includes("required") ||
    error.message.includes("incomplete") ||
    error.message.includes("retry shortly") ||
    error.message.includes("submission_id is already used") ||
    error.message.includes("attempt_session_id not found") ||
    error.message.includes("quiz submission record") ||
    error.message === QUIZ_SCORING_RESUBMIT_MESSAGE ||
    isQuizScoringResubmitError(error)
  ) {
    return 400;
  }
  return 500;
}

export async function handleCoursewareQuizEvaluation(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const pathname = requestPathname(req.url);
  if (req.method === "POST" && pathname === "/courseware/quiz/evaluate") {
    try {
      const body = evaluateBodySchema.parse(await readJsonBody<unknown>(req));
      // The gate section and the recording section must match (R10): the query's sectionId is used for
      // the enrollment decision and body.section_id for the record projection; if they differed, a readable section could authorize while
      // writing answers into another section of the same courseware, so it is refused directly
      const claimedSectionId = resolveRequestSectionId(req);
      if (
        claimedSectionId &&
        body.section_id &&
        normalizeOrgId(body.section_id) !== normalizeOrgId(claimedSectionId)
      ) {
        sendJson(res, 400, { ok: false, error: "section_id mismatch between query and body" });
        return true;
      }
      const session = await requireRequestSession(req);
      const { courseware } = await loadCoursewareByIdWithRequestAccess(req, body.courseware_id, "read", {
        allowEnrolledSectionRead: true,
      });
      // Trusted editor preview only: managed_list + manage_login (not learner/section read).
      const allowClientQuestionSnapshot =
        hasManageLoginPermission(session.permissions) &&
        (await canAccessCoursewareOrg(session, courseware));
      const result = await evaluateCoursewareQuizSubmission({
        courseware,
        session,
        allowClientQuestionSnapshot,
        input: {
          coursewareId: body.courseware_id,
          orgId: body.org_id,
          courseId: body.course_id,
          sectionId: body.section_id,
          sceneId: body.scene_id,
          slideElementId: body.slide_element_id,
          questionId: body.question_id,
          questionWrapperId: body.question_wrapper_id,
          language: body.language,
          question: body.question,
          attemptSessionId: body.attempt_session_id,
          submissionId: body.submission_id,
          answer: body.answer,
          quizTotalRequired: body.quiz_total_required,
          requiredQuestionWrapperIds: body.required_question_wrapper_ids,
        },
      });
      sendJson(res, 200, { ok: true, data: result });
    } catch (error) {
      sendJson(res, errorStatus(error), {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to evaluate quiz answer",
        ...(isQuizScoringResubmitError(error) ? { error_code: error.code } : {}),
      });
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/courseware/quiz/sessions/complete") {
    try {
      const body = completeBodySchema.parse(await readJsonBody<unknown>(req));
      const session = await requireRequestSession(req);
      const result = await completeCoursewareQuizAttempt({
        session,
        input: {
          coursewareId: body.courseware_id,
          attemptSessionId: body.attempt_session_id,
        },
      });
      sendJson(res, 200, { ok: true, data: result });
    } catch (error) {
      sendJson(res, errorStatus(error), {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to complete quiz session",
      });
    }
    return true;
  }

  if (req.method === "GET" && pathname === "/courseware/quiz/answers") {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const query = answersQuerySchema.parse({
        attempt_session_id: url.searchParams.get("attempt_session_id") || undefined,
        courseware_id: url.searchParams.get("courseware_id") || undefined,
        section_id: url.searchParams.get("section_id") || undefined,
      });
      const session = await requireRequestSession(req);
      const result = await listCoursewareQuizAnswers({
        session,
        attemptSessionId: query.attempt_session_id,
        coursewareId: query.courseware_id,
        sectionId: query.section_id,
      });
      sendJson(res, 200, { ok: true, data: result });
    } catch (error) {
      sendJson(res, errorStatus(error), {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to list quiz answers",
      });
    }
    return true;
  }

  return false;
}
