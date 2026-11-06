// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";

import { QueryFailedError } from "typeorm";
// TypeORM's deep-partial type rejects jsonb (Record) columns and relations; values pass through.
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity.js";

import { dataSource } from "../db/db.ts";
import { ensureDataSource } from "../db/ensure-data-source.ts";
import { ainobiBackendApiUrl } from "../config/ainobi-backend-api.ts";
import { refreshCoursewareRecordingFileUrlForResponse } from "./courseware-object-url-response.ts";
import type { AinobiAuthorizedSession } from "../auth/ainobi-user-session.ts";
import { normalizeOrgId } from "../auth/ainobi-org-access.ts";
import { Courseware as CoursewareEntity, CoursewareVersion } from "../models/courseware.ts";
import { CoursewareQuizAnswerRecording } from "../models/courseware-quiz-answer-recordings.ts";
import {
  CoursewareQuizAttemptSession,
  CoursewareQuizSubmission,
} from "../models/courseware-quiz-attempts.ts";
import {
  coursewareQuizQuestionUsesAiScoring,
  evaluateCoursewareQuizAnswer,
  type CoursewareQuizAnswerContent,
  type CoursewareQuizScoreResult,
} from "@ainobi/courseware-core/quiz-scoring.ts";
import {
  createDefaultQuizConfig,
  type QuizConfig,
  type QuizQuestion,
} from "@ainobi/courseware-core/quiz.ts";
import {
  collectTopLevelQuizWrappersFromSceneContent,
  countQuizQuestionsExpectedForCompletionFromSceneContent,
  mergeRequiredWrapperIds,
  type QuizCompletionCountHints,
  requiredWrapperIds,
  sumTopLevelBoundQuizMaxScoreFromSceneContent,
} from "@ainobi/courseware-core/quiz-preview-wrappers.ts";
import type { Courseware } from "../models/courseware.ts";
import { getCoursewareEntityById } from "./courseware-service.ts";
import { findCoursewareSectionBinding } from "./courseware-section-binding-service.ts";
import { scoreCoursewareQuizAnswerWithAi } from "./courseware-quiz-ai-scoring.ts";
import {
  pickQuizFeedbackLanguage,
  resolveSectionAiTeacherLanguage,
} from "./courseware-quiz-feedback-language.ts";

export type CoursewareQuizEvaluateInput = {
  coursewareId: string;
  orgId?: string;
  courseId?: string;
  sectionId?: string;
  sceneId?: string;
  slideElementId?: string;
  questionId?: string;
  questionWrapperId: string;
  language?: string;
  /** Optional client question snapshot for editor/local preview only (no course/section binding). */
  question?: unknown;
  attemptSessionId?: string;
  submissionId?: string;
  answer: CoursewareQuizAnswerContent;
  quizTotalRequired?: number;
  requiredQuestionWrapperIds?: string[];
};

export type CoursewareQuizCompleteInput = {
  coursewareId: string;
  attemptSessionId: string;
};

export type CoursewareQuizEvaluationResponse = {
  attempt_session_id: string;
  submission_id: string;
  score: number;
  max_score: number;
  raw_score: number;
  passed: boolean;
  can_advance: boolean;
  feedback: string;
  feedback_detail: Record<string, unknown> | null;
  aggregate: CoursewareQuizAggregate;
};

export type CoursewareQuizAggregate = {
  total_score: number;
  max_score: number;
  answered_count: number;
  total_count: number;
  completed: boolean;
};

export type CoursewareQuizCompleteResponse = CoursewareQuizAggregate & {
  attempt_session_id: string;
  homework_submitted: boolean;
  homework_submitted_at: string | null;
};

export type CoursewareQuizAnswerRecordDto = {
  submission_id: string;
  attempt_session_id: string;
  question_id: string;
  question_wrapper_id: string;
  slide_element_id: string | null;
  question_type: string;
  question_title: string | null;
  answer: Record<string, unknown>;
  score: number;
  max_score: number;
  passed: boolean;
  can_advance: boolean;
  feedback: string;
  feedback_detail: Record<string, unknown> | null;
  recording_id: string | null;
  submitted_at: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function quizConfigFromScene(content: Record<string, unknown>): QuizConfig | null {
  const quiz = asRecord(content.quiz);
  if (!quiz || quiz.enabled === false || !Array.isArray(quiz.questions)) {
    return null;
  }
  return quiz as unknown as QuizConfig;
}

/** Editor/local preview may send a question snapshot when scene.quiz is missing or stale. */
export function parseClientQuestionSnapshot(
  question: unknown,
  expectedQuestionId: string | undefined,
): QuizQuestion | null {
  if (!question || typeof question !== "object" || Array.isArray(question)) {
    return null;
  }
  const candidate = question as QuizQuestion;
  const questionId = typeof candidate.question_id === "string" ? candidate.question_id.trim() : "";
  if (!questionId) {
    return null;
  }
  const expected = expectedQuestionId?.trim();
  if (expected && questionId !== expected) {
    throw new Error("question snapshot question_id does not match request");
  }
  return candidate;
}

function evaluateAggregateHints(
  input: Pick<CoursewareQuizEvaluateInput, "requiredQuestionWrapperIds" | "quizTotalRequired">,
): QuizCompletionCountHints | undefined {
  const requiredQuestionWrapperIds = input.requiredQuestionWrapperIds?.filter((id) => id.trim().length > 0);
  const quizTotalRequired = input.quizTotalRequired;
  if ((!requiredQuestionWrapperIds || requiredQuestionWrapperIds.length === 0) && !quizTotalRequired) {
    return undefined;
  }
  return {
    requiredQuestionWrapperIds,
    quizTotalRequired,
  };
}

function findQuestionByInput(quiz: QuizConfig, input: Pick<CoursewareQuizEvaluateInput, "questionId" | "questionWrapperId">): QuizQuestion | null {
  const byId = input.questionId?.trim();
  if (byId) {
    const found = quiz.questions.find((q) => q.question_id === byId);
    if (found) {
      return found;
    }
  }
  return quiz.questions.find((q) => q.question_id === input.questionWrapperId) ?? null;
}

export function resolveQuestionForEvaluation(
  quiz: QuizConfig | null,
  input: Pick<CoursewareQuizEvaluateInput, "questionId" | "questionWrapperId" | "question">,
  mappedQuestionId: string | undefined,
  options?: { allowClientSnapshot?: boolean },
): QuizQuestion | null {
  if (quiz) {
    const fromScene = findQuestionByInput(quiz, {
      questionId: input.questionId || mappedQuestionId,
      questionWrapperId: input.questionWrapperId,
    });
    if (fromScene) {
      return fromScene;
    }
  }

  if (options?.allowClientSnapshot === false) {
    return null;
  }

  const expectedQuestionId = (input.questionId || mappedQuestionId || input.questionWrapperId)?.trim();
  return parseClientQuestionSnapshot(input.question, expectedQuestionId);
}

/**
 * Prefer scene quiz. Client-only synthesis is for editor/local preview when scene.quiz is absent.
 * Never merge a client question into an existing scene quiz (authoritative scoring).
 */
export function resolveQuizConfigForEvaluation(
  content: Record<string, unknown>,
  question: QuizQuestion | null,
  options?: { allowClientSnapshot?: boolean },
): QuizConfig | null {
  const fromScene = quizConfigFromScene(content);
  if (fromScene) {
    return fromScene;
  }
  if (!question || options?.allowClientSnapshot === false) {
    return null;
  }
  return {
    ...createDefaultQuizConfig(),
    enabled: true,
    total_score: Math.max(0, Number(question.score) || 0),
    questions: [question],
  };
}

/**
 * Every quiz attempt must belong to an organization; the error text carries
 * "required" so the HTTP layer maps it to 400 (see errorStatus).
 */
export const ORG_REQUIRED_FOR_QUIZ_EVALUATION_MESSAGE =
  "org_id is required to evaluate courseware quiz answers: this courseware is not linked to any organization — an organization is assigned when the courseware is created";

/**
 * Pure attribution decision (single-org policy): a courseware belongs to
 * exactly ONE organization, assigned at creation and never rewritten, so the
 * attempt and billing org is ALWAYS the courseware's own org. Section
 * bindings and the login session never contribute — cross-org reuse goes
 * through clone, which produces a separate courseware owned by the target
 * org. A client-supplied org is a consistency check only: it must equal the
 * courseware org and is never a resolution source. Attempts REQUIRE an org:
 * an org-less courseware (only possible for legacy rows) resolves to null and
 * `resolveAttemptSession` rejects — there is deliberately no personal,
 * login-session, or section-binding fallback.
 */
export function pickQuizAttemptOrgId(params: {
  fromInput: string | null;
  fromCourseware: string | null;
}): string | null {
  // Normalize uuid case before comparing, or uppercase UUIDs would be judged cross-organization
  const fromInput = normalizeOrgId(params.fromInput);
  const fromCourseware = normalizeOrgId(params.fromCourseware);
  if (fromInput) {
    if (!fromCourseware) {
      // Nothing resource-side to verify the supplied org against — reject with
      // the real cause (org-less courseware) instead of a misleading mismatch.
      throw new Error(ORG_REQUIRED_FOR_QUIZ_EVALUATION_MESSAGE);
    }
    if (fromInput !== fromCourseware) {
      throw new Error("org_id does not match authorized courseware");
    }
    return fromInput;
  }
  return fromCourseware;
}

/**
 * Resolve the attempt org for a quiz evaluation (single-org policy): it is the
 * courseware's own org, full stop. No DB lookup, no session fallback.
 */
export function resolveQuizAttemptOrgId(params: {
  input: Pick<CoursewareQuizEvaluateInput, "orgId">;
  courseware: Pick<Courseware, "id" | "orgId">;
}): string | null {
  return pickQuizAttemptOrgId({
    fromInput: params.input.orgId ?? null,
    fromCourseware: params.courseware.orgId ?? null,
  });
}

async function resolveAttemptCourseContext(params: {
  courseware: Courseware;
  orgId: string;
  input: Pick<CoursewareQuizEvaluateInput, "courseId" | "sectionId">;
}): Promise<{ courseId: string | null; sectionId: string | null }> {
  const courseId = params.input.courseId?.trim() || null;
  const sectionId = params.input.sectionId?.trim() || null;
  if (!courseId || !sectionId) {
    return { courseId, sectionId };
  }
  const binding = await findCoursewareSectionBinding({
    coursewareId: params.courseware.id,
    sectionId,
    courseId,
    orgId: params.orgId,
  });
  if (!binding) {
    throw new Error("courseware is not bound to the requested section");
  }
  return { courseId: binding.courseId, sectionId: binding.sectionId };
}

function assertAttemptIsActive(attempt: CoursewareQuizAttemptSession): void {
  if (attempt.status === "completed") {
    throw new Error("attempt_session_id is already completed");
  }
}

function assertSubmissionMatchesRetry(
  stored: CoursewareQuizSubmission,
  input: Pick<CoursewareQuizEvaluateInput, "questionWrapperId" | "questionId">,
): void {
  if (stored.questionWrapperId !== input.questionWrapperId.trim()) {
    throw new Error("submission_id does not match question_wrapper_id");
  }
  const requestedQuestionId = input.questionId?.trim();
  if (requestedQuestionId && stored.questionId !== requestedQuestionId) {
    throw new Error("submission_id does not match question_id");
  }
}

async function latestCoursewareSnapshot(
  courseware: Courseware,
): Promise<{ revision: number | null; content: Record<string, unknown> }> {
  const content = courseware.content;
  const version = await dataSource.getRepository(CoursewareVersion).findOne({
    where: { coursewareId: courseware.id },
    order: { revision: "DESC" },
  });
  if (version && JSON.stringify(version.content) === JSON.stringify(content)) {
    return { revision: version.revision, content };
  }
  return { revision: null, content };
}

function attemptProjectsToSection(
  attempt: Pick<CoursewareQuizAttemptSession, "courseId" | "sectionId">,
): boolean {
  return Boolean(attempt.courseId?.trim() && attempt.sectionId?.trim());
}

function initialSubmissionProjectionStatus(
  attempt: Pick<CoursewareQuizAttemptSession, "courseId" | "sectionId">,
): CoursewareQuizSubmission["projectionStatus"] {
  return attemptProjectsToSection(attempt) ? "pending" : "skipped";
}

function assertAttemptCourseContextMatches(
  existing: Pick<CoursewareQuizAttemptSession, "courseId" | "sectionId">,
  requested: { courseId: string | null; sectionId: string | null },
): void {
  if (requested.courseId && existing.courseId && requested.courseId !== existing.courseId) {
    throw new Error("course_id does not match attempt_session_id");
  }
  if (requested.sectionId && existing.sectionId && requested.sectionId !== existing.sectionId) {
    throw new Error("section_id does not match attempt_session_id");
  }
}

function submissionNeedsProjection(
  submission: Pick<CoursewareQuizSubmission, "projectionStatus">,
  attempt: Pick<CoursewareQuizAttemptSession, "courseId" | "sectionId">,
): boolean {
  if (submission.projectionStatus === "projected") {
    return false;
  }
  if (submission.projectionStatus === "skipped" && !attemptProjectsToSection(attempt)) {
    return false;
  }
  return true;
}

async function findReusableActiveAttempt(params: {
  coursewareId: string;
  userId: string;
  courseId: string | null;
  sectionId: string | null;
  sceneId: string | null;
}): Promise<CoursewareQuizAttemptSession | null> {
  const repo = dataSource.getRepository(CoursewareQuizAttemptSession);
  const qb = repo
    .createQueryBuilder("attempt")
    .where("attempt.courseware_id = :coursewareId", { coursewareId: params.coursewareId })
    .andWhere("attempt.user_id = :userId", { userId: params.userId })
    .andWhere("attempt.status = :status", { status: "active" });
  if (params.sectionId) {
    qb.andWhere("attempt.section_id = :sectionId", { sectionId: params.sectionId });
  }
  if (params.courseId) {
    qb.andWhere("attempt.course_id = :courseId", { courseId: params.courseId });
  }
  if (params.sceneId) {
    qb.andWhere("attempt.scene_id = :sceneId", { sceneId: params.sceneId });
  }
  return qb.orderBy("attempt.created_at", "DESC").getOne();
}

/**
 * Single-org policy: an attempt must carry the courseware's own org. Legacy or
 * poisoned rows fail loud here instead of continuing to bill and project under
 * a foreign org. Apply this before any scoring, billing, or projection that
 * uses `attempt.orgId`.
 */
function assertAttemptOrgMatchesCourseware(
  attempt: Pick<CoursewareQuizAttemptSession, "orgId">,
  courseware: Pick<Courseware, "orgId">,
): void {
  const cwOrgId = normalizeOrgId(courseware.orgId);
  if (!cwOrgId) {
    throw new Error(ORG_REQUIRED_FOR_QUIZ_EVALUATION_MESSAGE);
  }
  const attemptOrgId = normalizeOrgId(attempt.orgId);
  if (attemptOrgId && attemptOrgId !== cwOrgId) {
    throw new Error("attempt_session_id does not belong to this courseware organization");
  }
}

/**
 * Same check for the paths that hold only an attempt row (session completion,
 * projection retry worker) and therefore have to load the courseware first.
 */
async function assertAttemptOrgStillAuthoritative(
  attempt: Pick<CoursewareQuizAttemptSession, "orgId" | "coursewareId">,
): Promise<void> {
  const courseware = await dataSource.getRepository(CoursewareEntity).findOne({
    where: { id: attempt.coursewareId },
    select: ["id", "orgId"],
  });
  if (!courseware) {
    throw new Error(`courseware not found: ${attempt.coursewareId}`);
  }
  assertAttemptOrgMatchesCourseware(attempt, courseware);
}

/** Whether a scene can answer this request: its quiz has the question, by id or through the wrapper on its slides. */
function sceneHasQuestion(
  content: Record<string, unknown>,
  input: Pick<CoursewareQuizEvaluateInput, "questionId" | "questionWrapperId">,
): boolean {
  const quiz = quizConfigFromScene(content);
  if (!quiz) {
    return false;
  }
  const mapped = collectTopLevelQuizWrappersFromSceneContent(content).get(input.questionWrapperId);
  return findQuestionByInput(quiz, { questionId: input.questionId || mapped, questionWrapperId: input.questionWrapperId }) !== null;
}

/**
 * Whether a reused attempt takes the latest courseware instead of the snapshot frozen when it started: when the frozen
 * scene had no usable quiz, or, for an attempt no section grades (editor preview, Studio), when the question being
 * answered is missing from it but present now, because the author replaced or retyped the question while previewing.
 * An attempt a section grades keeps its snapshot, so its learners are scored against what they started.
 */
export function shouldRefreshAttemptSnapshot(
  attempt: Pick<CoursewareQuizAttemptSession, "coursewareSnapshot" | "courseId" | "sectionId">,
  latest: Record<string, unknown>,
  input: Pick<CoursewareQuizEvaluateInput, "questionId" | "questionWrapperId">,
): boolean {
  if (!quizConfigFromScene(latest)) {
    return false;
  }
  if (!quizConfigFromScene(attempt.coursewareSnapshot)) {
    return true;
  }
  if (attemptProjectsToSection(attempt)) {
    return false;
  }
  return !sceneHasQuestion(attempt.coursewareSnapshot, input) && sceneHasQuestion(latest, input);
}

async function patchAttemptSessionIfNeeded(params: {
  attempt: CoursewareQuizAttemptSession;
  courseware: Courseware;
  resolvedOrgId: string | null;
  input: CoursewareQuizEvaluateInput;
}): Promise<CoursewareQuizAttemptSession> {
  assertAttemptOrgMatchesCourseware(params.attempt, params.courseware);
  const repo = dataSource.getRepository(CoursewareQuizAttemptSession);
  const patch: Partial<CoursewareQuizAttemptSession> = {};
  if (!params.attempt.orgId && params.resolvedOrgId) {
    patch.orgId = params.resolvedOrgId;
    params.attempt.orgId = params.resolvedOrgId;
  }
  const courseContext = await resolveAttemptCourseContext({
    courseware: params.courseware,
    orgId: params.attempt.orgId || params.resolvedOrgId || "",
    input: params.input,
  });
  assertAttemptCourseContextMatches(params.attempt, courseContext);
  if (!params.attempt.courseId && courseContext.courseId) {
    patch.courseId = courseContext.courseId;
    params.attempt.courseId = courseContext.courseId;
  }
  if (!params.attempt.sectionId && courseContext.sectionId) {
    patch.sectionId = courseContext.sectionId;
    params.attempt.sectionId = courseContext.sectionId;
  }
  if (!params.attempt.sceneId && params.input.sceneId?.trim()) {
    patch.sceneId = params.input.sceneId.trim();
    params.attempt.sceneId = patch.sceneId;
  }
  // Reused active attempts freeze the snapshot at create time; see shouldRefreshAttemptSnapshot for when it moves on.
  // The latest courseware is read only when the frozen snapshot cannot answer this request.
  const frozen = params.attempt.coursewareSnapshot;
  if (!quizConfigFromScene(frozen) || (!attemptProjectsToSection(params.attempt) && !sceneHasQuestion(frozen, params.input))) {
    const snapshot = await latestCoursewareSnapshot(params.courseware);
    if (shouldRefreshAttemptSnapshot(params.attempt, snapshot.content, params.input)) {
      patch.coursewareSnapshot = snapshot.content;
      patch.coursewareRevision = snapshot.revision;
      params.attempt.coursewareSnapshot = snapshot.content;
      params.attempt.coursewareRevision = snapshot.revision;
    }
  }
  if (Object.keys(patch).length > 0) {
    await repo.update(params.attempt.attemptSessionId, patch as QueryDeepPartialEntity<CoursewareQuizAttemptSession>);
  }
  return params.attempt;
}

async function resolveAttemptSession(params: {
  courseware: Courseware;
  session: AinobiAuthorizedSession;
  input: CoursewareQuizEvaluateInput;
}): Promise<CoursewareQuizAttemptSession> {
  await ensureDataSource();
  const repo = dataSource.getRepository(CoursewareQuizAttemptSession);
  const requestedId = params.input.attemptSessionId?.trim();
  // Single-org policy: the attempt org is the courseware's own org. Reject an
  // org-less courseware up front so no attempt path (create or resume) can run
  // without an authoritative org.
  const resolvedOrgId = resolveQuizAttemptOrgId({
    courseware: params.courseware,
    input: params.input,
  });
  if (!resolvedOrgId) {
    throw new Error(ORG_REQUIRED_FOR_QUIZ_EVALUATION_MESSAGE);
  }
  if (requestedId) {
    const existing = await repo.findOne({ where: { attemptSessionId: requestedId } });
    if (existing) {
      if (existing.userId !== params.session.userId || existing.coursewareId !== params.courseware.id) {
        throw new Error("attempt_session_id does not belong to this user/courseware");
      }
      assertAttemptIsActive(existing);
      return patchAttemptSessionIfNeeded({
        attempt: existing,
        courseware: params.courseware,
        resolvedOrgId,
        input: params.input,
      });
    }
  }

  const orgId = resolvedOrgId;
  const courseContext = await resolveAttemptCourseContext({
    courseware: params.courseware,
    orgId,
    input: params.input,
  });
  const sceneId = params.input.sceneId?.trim() || null;
  const reusable = await findReusableActiveAttempt({
    coursewareId: params.courseware.id,
    userId: params.session.userId,
    courseId: courseContext.courseId,
    sectionId: courseContext.sectionId,
    sceneId,
  });
  if (reusable) {
    if (reusable.userId !== params.session.userId || reusable.coursewareId !== params.courseware.id) {
      throw new Error("attempt_session_id does not belong to this user/courseware");
    }
    assertAttemptIsActive(reusable);
    return patchAttemptSessionIfNeeded({
      attempt: reusable,
      courseware: params.courseware,
      resolvedOrgId,
      input: params.input,
    });
  }

  const snapshot = await latestCoursewareSnapshot(params.courseware);
  const attempt = repo.create({
    attemptSessionId: requestedId || randomUUID(),
    orgId,
    coursewareId: params.courseware.id,
    coursewareRevision: snapshot.revision,
    coursewareSnapshot: snapshot.content,
    userId: params.session.userId,
    courseId: courseContext.courseId,
    sectionId: courseContext.sectionId,
    sceneId,
    status: "active",
  });
  return repo.save(attempt);
}

function answerToRecord(answer: CoursewareQuizAnswerContent): Record<string, unknown> {
  return Object.fromEntries(Object.entries(answer).filter(([, value]) => value !== undefined));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function coursewareInternalToken(): string {
  const token =
    process.env.COURSEWARE_SERVICE_INTERNAL_TOKEN?.trim() ||
    process.env.AINOBI_COURSEWARE_INTERNAL_TOKEN?.trim();
  if (!token) {
    throw new Error("COURSEWARE_SERVICE_INTERNAL_TOKEN or AINOBI_COURSEWARE_INTERNAL_TOKEN is not configured");
  }
  return token;
}

function submissionToEvaluationResponse(
  submission: CoursewareQuizSubmission,
  aggregate: CoursewareQuizAggregate,
): CoursewareQuizEvaluationResponse {
  return {
    attempt_session_id: submission.attemptSessionId,
    submission_id: submission.submissionId,
    score: submission.score,
    max_score: submission.maxScore,
    raw_score: submission.rawScore,
    passed: submission.passed,
    can_advance: submission.canAdvance,
    feedback: submission.feedback,
    feedback_detail: submission.feedbackDetail,
    aggregate,
  };
}

function billingTransactionIdFromScore(score: CoursewareQuizScoreResult): string | null {
  const detail = score.feedbackDetail;
  const value = detail && typeof detail === "object" ? detail.billing_transaction_id : null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function postgresErrorCode(error: unknown): string | null {
  if (!(error instanceof QueryFailedError)) {
    return null;
  }
  const driver = error.driverError as { code?: string } | undefined;
  return typeof driver?.code === "string" ? driver.code : null;
}

function postgresErrorDetail(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof QueryFailedError)) {
    return null;
  }
  const driver = error.driverError as {
    code?: string;
    detail?: string;
    constraint?: string;
    table?: string;
    schema?: string;
  } | undefined;
  if (!driver) {
    return null;
  }
  return {
    postgresCode: driver.code ?? null,
    postgresDetail: driver.detail ?? null,
    postgresConstraint: driver.constraint ?? null,
    postgresTable: driver.table ?? null,
    postgresSchema: driver.schema ?? null,
    sql: error.query ?? null,
  };
}

export function logQuizEvaluationError(
  phase: string,
  error: unknown,
  context?: Record<string, unknown>,
): void {
  console.error("[courseware-quiz-evaluate]", {
    phase,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    ...postgresErrorDetail(error),
    ...context,
  });
}

function evaluateLogContext(params: {
  attempt?: CoursewareQuizAttemptSession;
  input: Pick<
    CoursewareQuizEvaluateInput,
    | "attemptSessionId"
    | "coursewareId"
    | "orgId"
    | "courseId"
    | "sectionId"
    | "sceneId"
    | "questionId"
    | "questionWrapperId"
    | "answer"
  >;
  submissionId: string;
  question?: QuizQuestion;
}): Record<string, unknown> {
  return {
    attemptSessionId: params.attempt?.attemptSessionId ?? params.input.attemptSessionId ?? null,
    submissionId: params.submissionId,
    questionWrapperId: params.input.questionWrapperId,
    questionId: params.input.questionId ?? params.question?.question_id ?? null,
    questionType: params.question?.type ?? null,
    coursewareId: params.input.coursewareId,
    orgId: params.input.orgId ?? params.attempt?.orgId ?? null,
    courseId: params.input.courseId ?? params.attempt?.courseId ?? null,
    sectionId: params.input.sectionId ?? params.attempt?.sectionId ?? null,
    sceneId: params.input.sceneId ?? params.attempt?.sceneId ?? null,
    recordingId: params.input.answer.recording_id ?? null,
    answerSkipped: params.input.answer.skipped === true,
  };
}

function submissionPersistError(
  operation: string,
  error: unknown,
  context?: Record<string, unknown>,
): Error {
  logQuizEvaluationError(`submission.${operation}`, error, context);
  const code = postgresErrorCode(error);
  const detail = error instanceof Error ? error.message : String(error);
  if (code === "23503") {
    return new Error(`Quiz attempt session is not available for submission (${detail})`);
  }
  if (code === "23505") {
    return new Error(`Quiz submission record already exists (${detail})`);
  }
  return new Error(`Failed to ${operation} quiz submission record: ${detail}`);
}

const SUBMISSION_QUESTION_TITLE_MAX = 512;

function submissionQuestionTitle(title: string | null | undefined): string | null {
  const trimmed = title?.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length <= SUBMISSION_QUESTION_TITLE_MAX) {
    return trimmed;
  }
  console.warn(
    `[courseware-quiz-evaluate] question_title truncated from ${trimmed.length} to ${SUBMISSION_QUESTION_TITLE_MAX} chars`,
  );
  return trimmed.slice(0, SUBMISSION_QUESTION_TITLE_MAX);
}

function buildPendingSubmissionFields(params: {
  question: QuizQuestion;
  input: CoursewareQuizEvaluateInput;
  answer: CoursewareQuizAnswerContent;
  recording: CoursewareQuizAnswerRecording | null;
  projectionStatus: CoursewareQuizSubmission["projectionStatus"];
}): Partial<CoursewareQuizSubmission> {
  return {
    questionId: params.question.question_id,
    questionWrapperId: params.input.questionWrapperId,
    slideElementId: params.input.slideElementId?.trim() || null,
    questionType: params.question.type,
    questionTitle: submissionQuestionTitle(params.question.title),
    answer: answerToRecord(params.answer),
    score: 0,
    maxScore: Math.max(0, Number(params.question.score) || 0),
    rawScore: 0,
    passed: false,
    canAdvance: false,
    feedback: "",
    feedbackDetail: null,
    recordingId: params.recording?.recordingId ?? null,
    billingTransactionId: null,
    projectionStatus: params.projectionStatus,
    projectionError: null,
    projectedAt: null,
    isActive: false,
    status: "pending",
  };
}

async function tryReturnCompletedSubmission(params: {
  submission: CoursewareQuizSubmission | null;
  attempt: CoursewareQuizAttemptSession;
  session: AinobiAuthorizedSession;
  input: CoursewareQuizEvaluateInput;
  question: QuizQuestion;
  quiz: QuizConfig;
}): Promise<CoursewareQuizEvaluationResponse | null> {
  const submission = params.submission;
  if (!submission || submission.status === "pending") {
    return null;
  }
  if (submission.status === "failed") {
    throw new Error(submission.projectionError || "Quiz submission scoring failed; retry with a new submission_id");
  }
  assertSubmissionMatchesRetry(submission, params.input);
  if (submission.projectionStatus !== "projected" && submission.projectionStatus !== "skipped") {
    await projectSubmissionOrThrow({
      session: params.session,
      attempt: params.attempt,
      input: params.input,
      question: params.question,
      answer: submission.answer as CoursewareQuizAnswerContent,
      score: {
        score: submission.score,
        maxScore: submission.maxScore,
        rawScore: submission.rawScore,
        passed: submission.passed,
        canAdvance: submission.canAdvance,
        feedback: submission.feedback,
        feedbackDetail: submission.feedbackDetail,
      },
      submission,
      quiz: params.quiz,
    });
  }
  return submissionToEvaluationResponse(
    submission,
    await aggregateAttempt(params.attempt, evaluateAggregateHints(params.input)),
  );
}

async function ensureSubmissionReadyForScoring(params: {
  attempt: CoursewareQuizAttemptSession;
  session: AinobiAuthorizedSession;
  input: CoursewareQuizEvaluateInput;
  question: QuizQuestion;
  quiz: QuizConfig;
  submissionId: string;
  answer: CoursewareQuizAnswerContent;
  recording: CoursewareQuizAnswerRecording | null;
}): Promise<CoursewareQuizEvaluationResponse | null> {
  const submissionRepo = dataSource.getRepository(CoursewareQuizSubmission);
  const attemptSessionId = params.attempt.attemptSessionId;
  const submissionId = params.submissionId;
  const questionWrapperId = params.input.questionWrapperId;
  const logContext = evaluateLogContext({
    attempt: params.attempt,
    input: params.input,
    submissionId,
    question: params.question,
  });
  const projectionStatus = initialSubmissionProjectionStatus(params.attempt);
  const pendingFields = buildPendingSubmissionFields({
    question: params.question,
    input: params.input,
    answer: params.answer,
    recording: params.recording,
    projectionStatus,
  });
  const where = { attemptSessionId, submissionId };
  const completedContext = {
    attempt: params.attempt,
    session: params.session,
    input: params.input,
    question: params.question,
    quiz: params.quiz,
  };

  const existing = await submissionRepo.findOne({ where });
  if (existing?.status === "scored") {
    return tryReturnCompletedSubmission({
      submission: existing,
      ...completedContext,
    });
  }

  let scoredDuringRace = false;

  try {
    await dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `${attemptSessionId}:${questionWrapperId}`,
      ]);

      const attemptExists = await manager.exists(CoursewareQuizAttemptSession, {
        where: { attemptSessionId },
      });
      if (!attemptExists) {
        const error = new Error(`attempt_session_id not found: ${attemptSessionId}`);
        logQuizEvaluationError("submission.prepare.attempt_missing", error, logContext);
        throw error;
      }

      await manager
        .createQueryBuilder()
        .delete()
        .from(CoursewareQuizSubmission)
        .where("attempt_session_id = :attemptSessionId", { attemptSessionId })
        .andWhere("question_wrapper_id = :questionWrapperId", { questionWrapperId })
        .andWhere("submission_id <> :submissionId", { submissionId })
        .andWhere("status IN (:...statuses)", { statuses: ["pending", "failed"] })
        .execute();

      const locked = await manager.findOne(CoursewareQuizSubmission, { where });
      if (locked?.status === "scored") {
        scoredDuringRace = true;
        return;
      }
      if (locked) {
        await manager.update(CoursewareQuizSubmission, where, pendingFields as QueryDeepPartialEntity<CoursewareQuizSubmission>);
        return;
      }

      try {
        await manager.insert(CoursewareQuizSubmission, {
          submissionId,
          attemptSessionId,
          ...pendingFields,
        } as QueryDeepPartialEntity<CoursewareQuizSubmission>);
      } catch (error) {
        if (postgresErrorCode(error) !== "23505") {
          throw submissionPersistError("insert", error, logContext);
        }
        const raced = await manager.findOne(CoursewareQuizSubmission, {
          where: { submissionId },
        });
        if (!raced) {
          throw submissionPersistError("insert", error, {
            ...logContext,
            uniqueRaceRecovery: "submission_row_missing_after_conflict",
          });
        }
        if (raced.attemptSessionId !== attemptSessionId) {
          const crossAttemptError = new Error("submission_id is already used by another quiz attempt");
          logQuizEvaluationError("submission.prepare.cross_attempt_submission_id", crossAttemptError, {
            ...logContext,
            existingAttemptSessionId: raced.attemptSessionId,
            existingSubmissionStatus: raced.status,
          });
          throw crossAttemptError;
        }
        if (raced.status === "scored") {
          scoredDuringRace = true;
          return;
        }
        await manager.update(CoursewareQuizSubmission, { submissionId }, pendingFields as QueryDeepPartialEntity<CoursewareQuizSubmission>);
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("attempt_session_id not found:")) {
      throw error;
    }
    if (error instanceof Error && error.message.includes("submission_id is already used")) {
      throw error;
    }
    throw submissionPersistError("persist", error, logContext);
  }

  if (scoredDuringRace) {
    const raced = await submissionRepo.findOne({ where });
    if (raced?.status === "scored") {
      return tryReturnCompletedSubmission({
        submission: raced,
        ...completedContext,
      });
    }
  }

  return null;
}

async function withProjectionRetries<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  const attempts = Math.max(1, Number(process.env.COURSEWARE_QUIZ_PROJECTION_RETRIES ?? 3) || 3);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(250 * attempt);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function coursewareIdsMatch(
  idOrKey: string,
  canonicalCoursewareId: string,
): Promise<boolean> {
  if (idOrKey === canonicalCoursewareId) {
    return true;
  }
  const courseware = await getCoursewareEntityById(idOrKey);
  return courseware?.id === canonicalCoursewareId;
}

async function recordingMatchesAttemptCourseware(
  recordingCoursewareId: string,
  attemptCoursewareId: string,
): Promise<boolean> {
  return coursewareIdsMatch(recordingCoursewareId, attemptCoursewareId);
}

async function assertAttemptBelongsToCourseware(
  inputCoursewareId: string | undefined,
  attemptCoursewareId: string,
): Promise<void> {
  const requested = inputCoursewareId?.trim();
  if (!requested) {
    return;
  }
  if (await coursewareIdsMatch(requested, attemptCoursewareId)) {
    return;
  }
  throw new Error("attempt_session_id does not belong to this courseware");
}

async function validateRecording(params: {
  attempt: CoursewareQuizAttemptSession;
  answer: CoursewareQuizAnswerContent;
  questionWrapperId: string;
}): Promise<CoursewareQuizAnswerRecording | null> {
  const recordingId = params.answer.recording_id?.trim();
  if (!recordingId) {
    return null;
  }
  const row = await dataSource.getRepository(CoursewareQuizAnswerRecording).findOne({
    where: { recordingId },
  });
  if (!row) {
    throw new Error("recording_id not found");
  }
  if (
    row.userId !== params.attempt.userId ||
    row.orgId !== params.attempt.orgId ||
    !(await recordingMatchesAttemptCourseware(row.coursewareId, params.attempt.coursewareId))
  ) {
    throw new Error("recording_id does not belong to this quiz attempt");
  }
  if (row.sceneId && params.attempt.sceneId && row.sceneId !== params.attempt.sceneId) {
    throw new Error("recording scene_id does not match this quiz attempt");
  }
  if (row.questionWrapperId && row.questionWrapperId !== params.questionWrapperId) {
    throw new Error("recording question_wrapper_id does not match this submission");
  }
  return row;
}

async function aggregateAttempt(
  attempt: CoursewareQuizAttemptSession,
  hints?: QuizCompletionCountHints,
): Promise<CoursewareQuizAggregate> {
  const submissions = await dataSource.getRepository(CoursewareQuizSubmission).find({
    where: { attemptSessionId: attempt.attemptSessionId, isActive: true },
  });
  const quiz = quizConfigFromScene(attempt.coursewareSnapshot);
  const requiredIds = quiz
    ? mergeRequiredWrapperIds(attempt.coursewareSnapshot, quiz, hints)
    : [...new Set(hints?.requiredQuestionWrapperIds ?? [])];
  const requiredSet = new Set(requiredIds);
  const wrapperMap = collectTopLevelQuizWrappersFromSceneContent(attempt.coursewareSnapshot);
  const questionById = new Map((quiz?.questions ?? []).map((question) => [question.question_id, question]));
  const relevant = requiredSet.size
    ? submissions.filter((submission) => requiredSet.has(submission.questionWrapperId))
    : submissions;
  const answeredWrappers = new Set(relevant.map((submission) => submission.questionWrapperId));
  const totalScore = relevant.reduce((sum, submission) => sum + submission.score, 0);
  const authoritativeMaxScore = requiredIds.reduce((sum, wrapperId) => {
    const questionId = wrapperMap.get(wrapperId);
    const question = questionId ? questionById.get(questionId) : null;
    return sum + Math.max(0, Number(question?.score) || 0);
  }, 0);
  const maxScore = requiredSet.size
    ? authoritativeMaxScore
    : (quiz
        ? sumTopLevelBoundQuizMaxScoreFromSceneContent(attempt.coursewareSnapshot, quiz)
        : 0) ||
      relevant.reduce((sum, submission) => sum + submission.maxScore, 0);
  const totalCount = quiz
    ? countQuizQuestionsExpectedForCompletionFromSceneContent(attempt.coursewareSnapshot, quiz, hints)
    : Math.max(
        submissions.length,
        hints?.requiredQuestionWrapperIds?.length ?? 0,
        hints?.quizTotalRequired ?? 0,
      );
  const aggregate = {
    total_score: totalScore,
    max_score: maxScore,
    answered_count: answeredWrappers.size,
    total_count: totalCount,
    completed: totalCount > 0 && answeredWrappers.size >= totalCount,
  };
  await dataSource.getRepository(CoursewareQuizAttemptSession).update(attempt.attemptSessionId, {
    totalScore,
    maxScore,
    answeredCount: aggregate.answered_count,
    totalCount,
  });
  return aggregate;
}

export async function evaluateCoursewareQuizSubmission(params: {
  courseware: Courseware;
  session: AinobiAuthorizedSession;
  input: CoursewareQuizEvaluateInput;
  /**
   * When true, caller is a trusted courseware org editor. Still only used for
   * non-section-bound preview attempts (no course/section projection).
   */
  allowClientQuestionSnapshot?: boolean;
}): Promise<CoursewareQuizEvaluationResponse> {
  const attempt = await resolveAttemptSession(params);
  const submissionId = params.input.submissionId?.trim() || randomUUID();
  const submissionRepo = dataSource.getRepository(CoursewareQuizSubmission);

  const sceneQuiz = quizConfigFromScene(attempt.coursewareSnapshot);
  const wrapperMap = collectTopLevelQuizWrappersFromSceneContent(attempt.coursewareSnapshot);
  const mappedQuestionId = wrapperMap.get(params.input.questionWrapperId);
  // Learners (read/section access) never supply scoring authority via client snapshots.
  // Editors may only do so for local preview attempts that do not project to a section.
  const allowClientSnapshot =
    params.allowClientQuestionSnapshot === true && !attemptProjectsToSection(attempt);
  const question = resolveQuestionForEvaluation(
    sceneQuiz,
    {
      questionId: params.input.questionId,
      questionWrapperId: params.input.questionWrapperId,
      question: params.input.question,
    },
    mappedQuestionId,
    { allowClientSnapshot },
  );
  const quiz = resolveQuizConfigForEvaluation(attempt.coursewareSnapshot, question, {
    allowClientSnapshot,
  });
  if (!quiz) {
    throw new Error("Courseware quiz is not enabled or has no questions");
  }
  if (!question) {
    throw new Error("Quiz question not found in courseware snapshot");
  }
  // Persist synthesized preview quiz so aggregate/retry paths can reload from snapshot.
  if (!sceneQuiz && allowClientSnapshot) {
    const nextSnapshot = {
      ...attempt.coursewareSnapshot,
      quiz,
    };
    attempt.coursewareSnapshot = nextSnapshot;
    await dataSource.getRepository(CoursewareQuizAttemptSession).update(attempt.attemptSessionId, {
      coursewareSnapshot: nextSnapshot,
    });
  }
  if (mappedQuestionId && mappedQuestionId !== question.question_id) {
    throw new Error("question_wrapper_id is not bound to the requested question");
  }
  if (params.input.answer.skipped === true && question.required !== false) {
    throw new Error("Required quiz questions cannot be skipped");
  }

  const recording = params.input.answer.skipped === true
    ? null
    : await validateRecording({
        attempt,
        answer: params.input.answer,
        questionWrapperId: params.input.questionWrapperId,
      });
  if (
    params.input.answer.skipped !== true &&
    (question.type === "shadowing" || question.type === "speech") &&
    !recording
  ) {
    throw new Error("recording_id is required for audio quiz scoring");
  }
  const answer = recording
    ? {
        ...params.input.answer,
        recording_id: recording.recordingId,
        recording_file_path: recording.filePath,
        // Fresh signature from the stored key — the column holds a stable
        // unsigned URL, which is NOT fetchable on the private OCI bucket.
        recording_file_url: refreshCoursewareRecordingFileUrlForResponse(recording.fileUrl),
        recording_duration_sec: recording.durationSec,
      }
    : params.input.answer;

  const submissionProjectionStatus = initialSubmissionProjectionStatus(attempt);
  const logContext = evaluateLogContext({
    attempt,
    input: params.input,
    submissionId,
    question,
  });

  const completedEarly = await ensureSubmissionReadyForScoring({
    attempt,
    session: params.session,
    input: params.input,
    question,
    quiz,
    submissionId,
    answer,
    recording,
  });
  if (completedEarly) {
    return completedEarly;
  }

  // Feedback language priority chain (issue #749): section AI-teacher language
  // -> normalized client hint -> "en". Editor preview has no sectionId and
  // naturally falls through to the client hint / English. Deterministic scoring
  // (choice / exact fill-blank / skipped) never consumes the language, so skip
  // the Redis + backend resolution entirely on that hot path.
  const usesAiScoring = coursewareQuizQuestionUsesAiScoring(question);
  const feedbackSectionId = attempt.sectionId?.trim() || params.input.sectionId?.trim() || null;
  const teacherLanguage =
    usesAiScoring && feedbackSectionId
      ? await resolveSectionAiTeacherLanguage(params.session, feedbackSectionId)
      : null;
  const feedbackLanguage = pickQuizFeedbackLanguage(teacherLanguage, params.input.language);

  let score: CoursewareQuizScoreResult;
  try {
    score = await evaluateCoursewareQuizAnswer(
      question,
      answer,
      usesAiScoring
        ? ({ question: aiQuestion, answer: aiAnswer }) =>
            scoreCoursewareQuizAnswerWithAi({
              session: params.session,
              orgId: attempt.orgId,
              question: aiQuestion,
              answer: aiAnswer,
              submissionId,
              questionWrapperId: params.input.questionWrapperId,
              language: feedbackLanguage,
            })
        : undefined,
      // Fixed feedback text of deterministic questions also follows the resolved language (client hint → English, no teacher lookup, guard kept)
      feedbackLanguage,
    );
  } catch (error) {
    logQuizEvaluationError("scoring", error, logContext);
    await submissionRepo.update(
      { attemptSessionId: attempt.attemptSessionId, submissionId },
      {
        status: "failed",
        isActive: false,
        projectionStatus: "failed",
        projectionError: error instanceof Error ? error.message : String(error),
      },
    );
    throw error;
  }

  const billingTransactionId = billingTransactionIdFromScore(score);

  try {
  await dataSource.transaction(async (manager) => {
    await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `${attempt.attemptSessionId}:${params.input.questionWrapperId}`,
    ]);
    await manager.update(
      CoursewareQuizSubmission,
      {
        attemptSessionId: attempt.attemptSessionId,
        questionWrapperId: params.input.questionWrapperId,
        isActive: true,
      },
      { isActive: false },
    );
    await manager.update(
      CoursewareQuizSubmission,
      { attemptSessionId: attempt.attemptSessionId, submissionId },
      {
        questionId: question.question_id,
        slideElementId: params.input.slideElementId?.trim() || null,
        questionType: question.type,
        questionTitle: submissionQuestionTitle(question.title),
        answer: answerToRecord(answer),
        score: score.score,
        maxScore: score.maxScore,
        rawScore: score.rawScore,
        passed: score.passed,
        canAdvance: score.canAdvance,
        feedback: score.feedback,
        feedbackDetail: score.feedbackDetail,
        recordingId: recording?.recordingId ?? null,
        billingTransactionId,
        projectionStatus: submissionProjectionStatus,
        projectionError: null,
        projectedAt: null,
        isActive: true,
        status: "scored",
      } as QueryDeepPartialEntity<CoursewareQuizSubmission>,
    );
  });
  } catch (error) {
    logQuizEvaluationError("submission.finalize", error, logContext);
    await submissionRepo.update(
      { attemptSessionId: attempt.attemptSessionId, submissionId },
      {
        status: "failed",
        isActive: false,
        projectionStatus: "failed",
        projectionError: error instanceof Error ? error.message : String(error),
      },
    );
    throw error;
  }
  const submission = await submissionRepo.findOneOrFail({
    where: { attemptSessionId: attempt.attemptSessionId, submissionId },
  });
  await projectSubmissionOrThrow({
    session: params.session,
    attempt,
    input: params.input,
    question,
    answer,
    score,
    submission,
    quiz,
  });
  return submissionToEvaluationResponse(submission, await aggregateAttempt(attempt, evaluateAggregateHints(params.input)));
}

async function projectSubmissionOrThrow(params: {
  session?: AinobiAuthorizedSession;
  attempt: CoursewareQuizAttemptSession;
  input: CoursewareQuizEvaluateInput;
  question: QuizQuestion;
  answer: CoursewareQuizAnswerContent;
  score: CoursewareQuizScoreResult;
  submission: CoursewareQuizSubmission;
  quiz: QuizConfig | null;
}): Promise<void> {
  const repo = dataSource.getRepository(CoursewareQuizSubmission);
  if (!params.attempt.courseId || !params.attempt.sectionId) {
    await repo.update(params.submission.submissionId, {
      projectionStatus: "skipped",
      projectionError: null,
      projectedAt: new Date(),
    });
    params.submission.projectionStatus = "skipped";
    params.submission.projectionError = null;
    params.submission.projectedAt = new Date();
    return;
  }
  try {
    await withProjectionRetries(() => callBackendAnswerProjection(params));
    const projectedAt = new Date();
    await repo.update(params.submission.submissionId, {
      projectionStatus: "projected",
      projectionError: null,
      projectedAt,
    });
    params.submission.projectionStatus = "projected";
    params.submission.projectionError = null;
    params.submission.projectedAt = projectedAt;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await repo.update(params.submission.submissionId, {
      projectionStatus: "failed",
      projectionError: message,
    });
    params.submission.projectionStatus = "failed";
    params.submission.projectionError = message;
    throw error;
  }
}

async function callBackendAnswerProjection(params: {
  session?: AinobiAuthorizedSession;
  attempt: CoursewareQuizAttemptSession;
  input: CoursewareQuizEvaluateInput;
  question: QuizQuestion;
  answer: CoursewareQuizAnswerContent;
  score: CoursewareQuizScoreResult;
  quiz: QuizConfig | null;
}): Promise<void> {
  if (!params.attempt.courseId || !params.attempt.sectionId) {
    return;
  }
  const url = ainobiBackendApiUrl(
    `/organization/${encodeURIComponent(params.attempt.orgId)}/courseware/quiz/internal/answer_projection`,
  );
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...(params.session ? { authorization: `Bearer ${params.session.accessToken}` } : {}),
      "x-ainobi-internal-token": coursewareInternalToken(),
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      user_id: params.attempt.userId,
      course_id: params.attempt.courseId,
      section_id: params.attempt.sectionId,
      scene_id: params.attempt.sceneId,
      slide_element_id: params.input.slideElementId ?? null,
      question_wrapper_id: params.input.questionWrapperId,
      question: params.question,
      answer: params.answer,
      score: params.score.score,
      max_score: params.score.maxScore,
      passed: params.score.passed,
      can_advance: params.score.canAdvance,
      feedback: params.score.feedback,
      feedback_detail: params.score.feedbackDetail,
      quiz_total_required: params.input.quizTotalRequired,
      required_question_wrapper_ids: params.input.requiredQuestionWrapperIds,
      quiz_max_score:
        params.quiz && params.quiz.total_score > 0 ? params.quiz.total_score : undefined,
    }),
  });
  const payload = await response.json().catch(() => null) as {
    code?: number;
    success?: boolean;
    message?: string;
  } | null;
  if (!response.ok || payload?.code !== 0 || payload.success !== true) {
    throw new Error(payload?.message || `Answer projection failed (${response.status})`);
  }
}

async function callBackendProgressProjection(params: {
  session?: AinobiAuthorizedSession;
  attempt: CoursewareQuizAttemptSession;
  aggregate: CoursewareQuizAggregate;
  requiredWrapperIds: string[];
}): Promise<{ homework_submitted: boolean; homework_submitted_at: string | null }> {
  if (!params.attempt.courseId || !params.attempt.sectionId) {
    return { homework_submitted: false, homework_submitted_at: null };
  }
  const url = ainobiBackendApiUrl(
    `/organization/${encodeURIComponent(params.attempt.orgId)}/courseware/quiz/internal/progress_projection`,
  );
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...(params.session ? { authorization: `Bearer ${params.session.accessToken}` } : {}),
      "x-ainobi-internal-token": coursewareInternalToken(),
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      user_id: params.attempt.userId,
      course_id: params.attempt.courseId,
      section_id: params.attempt.sectionId,
      scene_id: params.attempt.sceneId,
      total_score: params.aggregate.total_score,
      max_score: params.aggregate.max_score,
      answered_count: params.aggregate.answered_count,
      total_count: params.aggregate.total_count,
      required_question_wrapper_ids: params.requiredWrapperIds.length ? params.requiredWrapperIds : undefined,
    }),
  });
  const payload = await response.json().catch(() => null) as {
    code?: number;
    success?: boolean;
    data?: { homework_submitted?: boolean; homework_submitted_at?: string | null };
    message?: string;
  } | null;
  if (!response.ok || payload?.code !== 0 || payload.success !== true || !payload.data) {
    throw new Error(payload?.message || `Progress projection failed (${response.status})`);
  }
  return {
    homework_submitted: Boolean(payload.data.homework_submitted),
    homework_submitted_at: payload.data.homework_submitted_at ?? null,
  };
}

async function ensureRequiredSubmissionsProjected(params: {
  attempt: CoursewareQuizAttemptSession;
  requiredWrapperIds: string[];
}): Promise<void> {
  if (!params.attempt.courseId || !params.attempt.sectionId) {
    return;
  }
  const repo = dataSource.getRepository(CoursewareQuizSubmission);
  const submissions = await repo.find({
    where: { attemptSessionId: params.attempt.attemptSessionId, isActive: true },
  });
  const required = new Set(params.requiredWrapperIds);
  const relevant = required.size
    ? submissions.filter((submission) => required.has(submission.questionWrapperId))
    : submissions;
  const unprojected = relevant.filter((submission) => submissionNeedsProjection(submission, params.attempt));
  if (unprojected.length > 0) {
    throw new Error("Quiz answer projection is not complete; retry shortly");
  }
}

async function assertAttemptCanComplete(
  attempt: CoursewareQuizAttemptSession,
  requiredWrapperIds: string[],
): Promise<void> {
  const submissions = await dataSource.getRepository(CoursewareQuizSubmission).find({
    where: { attemptSessionId: attempt.attemptSessionId, isActive: true },
  });
  const quiz = quizConfigFromScene(attempt.coursewareSnapshot);
  const questionById = new Map((quiz?.questions ?? []).map((question) => [question.question_id, question]));
  const wrapperMap = collectTopLevelQuizWrappersFromSceneContent(attempt.coursewareSnapshot);
  const required = new Set(requiredWrapperIds);
  const relevant = required.size
    ? submissions.filter((submission) => required.has(submission.questionWrapperId))
    : submissions;

  for (const submission of relevant) {
    const questionId = wrapperMap.get(submission.questionWrapperId) ?? submission.questionId;
    const question = questionId ? questionById.get(questionId) : null;
    if (!question) {
      continue;
    }
    if (question.advance_score > 0 && !submission.canAdvance) {
      throw new Error("Quiz attempt has questions that do not meet advance requirements");
    }
    if (question.pass_score > 0 && !submission.passed) {
      throw new Error("Quiz attempt has questions that do not meet pass requirements");
    }
  }

  const expectedTotal = quiz
    ? countQuizQuestionsExpectedForCompletionFromSceneContent(attempt.coursewareSnapshot, quiz)
    : required.size;
  const answeredWrappers = new Set(relevant.map((submission) => submission.questionWrapperId));
  if (expectedTotal > 0 && answeredWrappers.size < expectedTotal) {
    throw new Error("Quiz attempt is incomplete");
  }
}

function completeResponseFromAttempt(
  attempt: CoursewareQuizAttemptSession,
  aggregate: CoursewareQuizAggregate,
  projection: { homework_submitted: boolean; homework_submitted_at: string | null },
): CoursewareQuizCompleteResponse {
  return {
    attempt_session_id: attempt.attemptSessionId,
    total_score: attempt.totalScore ?? aggregate.total_score,
    max_score: attempt.maxScore ?? aggregate.max_score,
    answered_count: attempt.answeredCount ?? aggregate.answered_count,
    total_count: attempt.totalCount ?? aggregate.total_count,
    completed: true,
    ...projection,
  };
}

export async function completeCoursewareQuizAttempt(params: {
  session: AinobiAuthorizedSession;
  input: CoursewareQuizCompleteInput;
}): Promise<CoursewareQuizCompleteResponse> {
  await ensureDataSource();
  const repo = dataSource.getRepository(CoursewareQuizAttemptSession);
  const attempt = await repo.findOne({ where: { attemptSessionId: params.input.attemptSessionId } });
  if (!attempt || attempt.userId !== params.session.userId) {
    throw new Error("attempt_session_id not found");
  }
  await assertAttemptBelongsToCourseware(params.input.coursewareId, attempt.coursewareId);
  await assertAttemptOrgStillAuthoritative(attempt);
  const aggregate = await aggregateAttempt(attempt);
  const quiz = quizConfigFromScene(attempt.coursewareSnapshot);
  const requiredIds = quiz ? mergeRequiredWrapperIds(attempt.coursewareSnapshot, quiz) : [];

  if (attempt.status === "completed") {
    if (attempt.progressProjectionStatus === "projected" || attempt.progressProjectionStatus === "skipped") {
      return completeResponseFromAttempt(attempt, aggregate, {
        homework_submitted: attempt.progressProjectionStatus === "projected",
        homework_submitted_at: attempt.progressProjectedAt?.toISOString() ?? null,
      });
    }
    try {
      const projection = await withProjectionRetries(() => callBackendProgressProjection({
        session: params.session,
        attempt,
        aggregate,
        requiredWrapperIds: requiredIds,
      }));
      await repo.update(attempt.attemptSessionId, {
        progressProjectionStatus: "projected",
        progressProjectionError: null,
        progressProjectedAt: new Date(),
      });
      return completeResponseFromAttempt(attempt, aggregate, projection);
    } catch (error) {
      await repo.update(attempt.attemptSessionId, {
        progressProjectionStatus: "failed",
        progressProjectionError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  if (
    attempt.progressProjectionStatus === "failed" &&
    aggregate.completed
  ) {
    await assertAttemptCanComplete(attempt, requiredIds);
    await ensureRequiredSubmissionsProjected({ attempt, requiredWrapperIds: requiredIds });
    try {
      const projection = await withProjectionRetries(() => callBackendProgressProjection({
        session: params.session,
        attempt,
        aggregate,
        requiredWrapperIds: requiredIds,
      }));
      const completedAt = new Date();
      await repo.update(attempt.attemptSessionId, {
        status: "completed",
        completedAt,
        totalScore: aggregate.total_score,
        maxScore: aggregate.max_score,
        answeredCount: aggregate.answered_count,
        totalCount: aggregate.total_count,
        progressProjectionStatus: "projected",
        progressProjectionError: null,
        progressProjectedAt: completedAt,
      });
      return completeResponseFromAttempt(attempt, aggregate, projection);
    } catch (error) {
      await repo.update(attempt.attemptSessionId, {
        progressProjectionStatus: "failed",
        progressProjectionError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  assertAttemptIsActive(attempt);
  if (!aggregate.completed) {
    throw new Error("Quiz attempt is incomplete");
  }
  await assertAttemptCanComplete(attempt, requiredIds);
  await ensureRequiredSubmissionsProjected({ attempt, requiredWrapperIds: requiredIds });

  const progressProjectionStatus = attemptProjectsToSection(attempt) ? "pending" : "skipped";
  if (progressProjectionStatus === "skipped") {
    const completedAt = new Date();
    await repo.update(attempt.attemptSessionId, {
      status: "completed",
      completedAt,
      totalScore: aggregate.total_score,
      maxScore: aggregate.max_score,
      answeredCount: aggregate.answered_count,
      totalCount: aggregate.total_count,
      progressProjectionStatus: "skipped",
      progressProjectionError: null,
      progressProjectedAt: completedAt,
    });
    return completeResponseFromAttempt(attempt, aggregate, {
      homework_submitted: false,
      homework_submitted_at: null,
    });
  }

  try {
    const projection = await withProjectionRetries(() => callBackendProgressProjection({
      session: params.session,
      attempt,
      aggregate,
      requiredWrapperIds: requiredIds,
    }));
    const completedAt = new Date();
    await repo.update(attempt.attemptSessionId, {
      status: "completed",
      completedAt,
      totalScore: aggregate.total_score,
      maxScore: aggregate.max_score,
      answeredCount: aggregate.answered_count,
      totalCount: aggregate.total_count,
      progressProjectionStatus: "projected",
      progressProjectionError: null,
      progressProjectedAt: completedAt,
    });
    return completeResponseFromAttempt(attempt, aggregate, projection);
  } catch (error) {
    await repo.update(attempt.attemptSessionId, {
      progressProjectionStatus: "failed",
      progressProjectionError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function quizProjectionRetryIntervalMs(): number {
  const configured = Number(process.env.COURSEWARE_QUIZ_PROJECTION_RETRY_INTERVAL_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 60_000;
}

function quizProjectionRetryBatchSize(): number {
  const configured = Number(process.env.COURSEWARE_QUIZ_PROJECTION_RETRY_BATCH_SIZE);
  return Number.isFinite(configured) && configured > 0 ? Math.min(100, Math.floor(configured)) : 20;
}

async function retrySubmissionProjection(submission: CoursewareQuizSubmission): Promise<void> {
  const attempt = submission.attemptSession;
  await assertAttemptOrgStillAuthoritative(attempt);
  const quiz = quizConfigFromScene(attempt.coursewareSnapshot);
  const wrapperMap = collectTopLevelQuizWrappersFromSceneContent(attempt.coursewareSnapshot);
  if (!quiz) {
    throw new Error("Courseware quiz is not enabled or has no questions");
  }
  const question = findQuestionByInput(quiz, {
    questionId: submission.questionId || wrapperMap.get(submission.questionWrapperId),
    questionWrapperId: submission.questionWrapperId,
  });
  if (!question) {
    throw new Error("Quiz question not found in courseware snapshot");
  }
  await projectSubmissionOrThrow({
    attempt,
    input: {
      coursewareId: attempt.coursewareId,
      courseId: attempt.courseId ?? undefined,
      sectionId: attempt.sectionId ?? undefined,
      sceneId: attempt.sceneId ?? undefined,
      slideElementId: submission.slideElementId ?? undefined,
      questionId: submission.questionId,
      questionWrapperId: submission.questionWrapperId,
      answer: submission.answer as CoursewareQuizAnswerContent,
    },
    question,
    answer: submission.answer as CoursewareQuizAnswerContent,
    score: {
      score: submission.score,
      maxScore: submission.maxScore,
      rawScore: submission.rawScore,
      passed: submission.passed,
      canAdvance: submission.canAdvance,
      feedback: submission.feedback,
      feedbackDetail: submission.feedbackDetail,
    },
    submission,
    quiz,
  });
}

async function retryProgressProjection(attempt: CoursewareQuizAttemptSession): Promise<void> {
  await assertAttemptOrgStillAuthoritative(attempt);
  const quiz = quizConfigFromScene(attempt.coursewareSnapshot);
  const requiredIds = quiz ? mergeRequiredWrapperIds(attempt.coursewareSnapshot, quiz) : [];
  const aggregate = await aggregateAttempt(attempt);
  await withProjectionRetries(() => callBackendProgressProjection({
    attempt,
    aggregate,
    requiredWrapperIds: requiredIds,
  }));
  await dataSource.getRepository(CoursewareQuizAttemptSession).update(attempt.attemptSessionId, {
    progressProjectionStatus: "projected",
    progressProjectionError: null,
    progressProjectedAt: new Date(),
  });
}

let quizProjectionRetryTickRunning = false;

export async function runCoursewareQuizProjectionRetryTick(): Promise<void> {
  if (quizProjectionRetryTickRunning) {
    return;
  }
  quizProjectionRetryTickRunning = true;
  try {
    await ensureDataSource();
    const batchSize = quizProjectionRetryBatchSize();
    const submissionRepo = dataSource.getRepository(CoursewareQuizSubmission);
    const submissions = await submissionRepo
      .createQueryBuilder("s")
      .innerJoinAndSelect("s.attemptSession", "a")
      .where("s.status = :status", { status: "scored" })
      .andWhere("s.isActive = true")
      .andWhere("s.projectionStatus IN (:...statuses)", { statuses: ["pending", "failed"] })
      .andWhere("a.courseId IS NOT NULL")
      .andWhere("a.sectionId IS NOT NULL")
      .orderBy("s.createdAt", "ASC")
      .limit(batchSize)
      .getMany();
    for (const submission of submissions) {
      try {
        await retrySubmissionProjection(submission);
      } catch (error) {
        await submissionRepo.update(submission.submissionId, {
          projectionStatus: "failed",
          projectionError: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const attemptRepo = dataSource.getRepository(CoursewareQuizAttemptSession);
    const attempts = await attemptRepo
      .createQueryBuilder("a")
      .where("a.status = :status", { status: "completed" })
      .andWhere("a.courseId IS NOT NULL")
      .andWhere("a.sectionId IS NOT NULL")
      .andWhere("a.progressProjectionStatus IN (:...statuses)", { statuses: ["pending", "failed"] })
      .orderBy("a.completedAt", "ASC")
      .limit(batchSize)
      .getMany();
    for (const attempt of attempts) {
      try {
        await retryProgressProjection(attempt);
      } catch (error) {
        await attemptRepo.update(attempt.attemptSessionId, {
          progressProjectionStatus: "failed",
          progressProjectionError: error instanceof Error ? error.message : String(error),
        });
      }
    }

  } finally {
    quizProjectionRetryTickRunning = false;
  }
}

export function startCoursewareQuizProjectionRetryWorker(): void {
  if (process.env.COURSEWARE_QUIZ_PROJECTION_RETRY_WORKER_ENABLED === "false") {
    return;
  }
  const intervalMs = quizProjectionRetryIntervalMs();
  void runCoursewareQuizProjectionRetryTick().catch((error) => {
    console.warn("[courseware-quiz-projection] initial tick failed:", error instanceof Error ? error.message : error);
  });
  setInterval(() => {
    void runCoursewareQuizProjectionRetryTick().catch((error) => {
      console.warn("[courseware-quiz-projection] worker tick failed:", error instanceof Error ? error.message : error);
    });
  }, intervalMs);
  console.info(`[courseware-quiz-projection] worker started intervalMs=${intervalMs} batch=${quizProjectionRetryBatchSize()}`);
}

export async function listCoursewareQuizAnswers(params: {
  session: AinobiAuthorizedSession;
  attemptSessionId?: string;
  coursewareId?: string;
  sectionId?: string;
}): Promise<{ answers: CoursewareQuizAnswerRecordDto[] }> {
  await ensureDataSource();
  const submissionRepo = dataSource.getRepository(CoursewareQuizSubmission);
  const qb = submissionRepo
    .createQueryBuilder("s")
    .innerJoin(CoursewareQuizAttemptSession, "a", "a.attemptSessionId = s.attemptSessionId")
    .where("a.userId = :userId", { userId: params.session.userId })
    .andWhere("s.isActive = true");
  if (params.attemptSessionId?.trim()) {
    qb.andWhere("a.attemptSessionId = :attemptSessionId", { attemptSessionId: params.attemptSessionId.trim() });
  }
  if (params.coursewareId?.trim()) {
    const courseware = await getCoursewareEntityById(params.coursewareId.trim());
    if (!courseware) {
      return { answers: [] };
    }
    qb.andWhere("a.coursewareId = :coursewareId", { coursewareId: courseware.id });
  }
  if (params.sectionId?.trim()) {
    qb.andWhere("a.sectionId = :sectionId", { sectionId: params.sectionId.trim() });
  }
  const rows = await qb.orderBy("s.createdAt", "ASC").getMany();
  return {
    answers: rows.map((row) => ({
      submission_id: row.submissionId,
      attempt_session_id: row.attemptSessionId,
      question_id: row.questionId,
      question_wrapper_id: row.questionWrapperId,
      slide_element_id: row.slideElementId,
      question_type: row.questionType,
      question_title: row.questionTitle,
      answer: row.answer,
      score: row.score,
      max_score: row.maxScore,
      passed: row.passed,
      can_advance: row.canAdvance,
      feedback: row.feedback,
      feedback_detail: row.feedbackDetail,
      recording_id: row.recordingId,
      submitted_at: row.createdAt.toISOString(),
    })),
  };
}
