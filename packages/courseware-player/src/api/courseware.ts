// SPDX-License-Identifier: AGPL-3.0-only
import { api, coursewareApi as coursewareServiceApi } from "../host/requester.ts";
import { requireResourceOrgId } from "./org-path.ts";
import type { AITeacherInfo } from "../schemas/ai_teacher.ts";
import { defaultModelUrl } from "@ainobi/avatar/host";
import type { PaginatedResponse } from "@ainobi/web-kit/schemas/response/common";

export const COURSEWARE_ASSET_ACCEPTED_EXTENSIONS = [
  "html",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
  "svg",
  "tiff",
  "mp4",
  "mp3",
  "aac",
  "wav",
  "ogg",
  "webm",
  "pdf",
  "pptx",
  "docx",
  "xlsx",
  "txt",
  "md",
] as const;

export type CoursewareAssetExtension =
  (typeof COURSEWARE_ASSET_ACCEPTED_EXTENSIONS)[number];

export interface CoursewareAssetFileArtifactMetadata {
  slide_count: number;
  kind: "pdf" | "pptx";
  conversion?: Record<string, unknown>;
}

/** Parse the page count from the `fileArtifactMetadata` the agent returns (top level or `conversion.slide_count`). */
export function getCoursewareAssetArtifactSlideCount(asset: CoursewareAssetItem): number {
  const meta = asset.fileArtifactMetadata;
  if (!meta || typeof meta.slide_count !== "number" || !Number.isFinite(meta.slide_count)) {
    return 1;
  }
  const n = Math.floor(meta.slide_count);
  return n >= 1 ? n : 1;
}

export interface CoursewareAssetItem {
  /** Courseware asset `file_id` (uuid); the same as `fileId` in the list/get APIs and `courseware_assets.file_id` in the DB. */
  id: string;
  /** File content MD5 (32 hex characters, used for the OSS object key). */
  contentMd5?: string;
  name: string;
  url: string;
  /** Page base URL of the PDF/PPTX conversion output (HTML CDN); absent for non-document assets. */
  fileArtifactUrl?: string | null;
  /** PDF/PPTX conversion metadata (with slide_count); absent for non-document assets. */
  fileArtifactMetadata?: CoursewareAssetFileArtifactMetadata | null;
  extension: CoursewareAssetExtension;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface CoursewareAssetInfo {
  file_id: string;
  file_name: string;
  file_size: number;
  content_type: string;
  file_path: string;
  file_url: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface CoursewareAssetCreateRequest {
  file_name: string;
  file_size: number;
  content_type: string;
  file_path: string;
  file_url: string;
}

export interface UploadCoursewareAssetResponse {
  asset: CoursewareAssetItem;
  /** Storage object key for API payloads (e.g. quiz audio scoring). */
  file_path: string;
}

/** Coarse asset category for list filtering; matches server `asset_kind` and editor `getAssetKind`. */
export const COURSEWARE_ASSET_KIND_FILTERS = [
  "image",
  "video",
  "audio",
  "html",
  "ppt",
  "other",
] as const;
export type CoursewareAssetKindFilter = (typeof COURSEWARE_ASSET_KIND_FILTERS)[number];

export interface ListCoursewareAssetsParams {
  /** Agent `courseware.id` (URL `courseware_id`); assets are isolated per courseware. */
  courseware_id: string;
  page_number?: number;
  page_size?: number;
  file_name?: string;
  order?: "asc" | "desc";
  /** When set, only assets in this category are returned (server-supported). */
  asset_kind?: CoursewareAssetKindFilter;
}

export type ListCoursewareAssetsResponse = PaginatedResponse<CoursewareAssetItem>;

export interface GetCoursewareAITeachersResponse {
  ai_teachers: AITeacherInfo[];
}

export type CoursewareQuizAnswerContent = {
  /** Optional question skipped: the courseware service doesn't score it or require a recording; it records 0 points and allows moving on. */
  skipped?: boolean;
  selected_option_ids?: string[];
  selected_option_indices?: number[];
  values?: string[];
  value_by_member_id?: Record<string, string>;
  recording_member_id?: string | null;
  /** Courseware service recording row id; preferred over object key/url for AI audio scoring. */
  recording_id?: string | null;
  /** Legacy audio path kept for read-model display; audio scoring requires recording_id. */
  recording_file_path?: string | null;
  /** Legacy audio URL kept for read-model display; audio scoring requires recording_id. */
  recording_file_url?: string | null;
  /** Client-reported duration in seconds (optional metadata for scoring). */
  recording_duration_sec?: number | null;
};

export interface SubmitCoursewareQuizAnswerRequest {
  courseware_id?: string;
  course_id?: string;
  section_id?: string;
  scene_id?: string;
  slide_element_id?: string;
  question_id?: string;
  question_wrapper_id: string;
  /** Desired language for learner-facing scoring feedback. */
  language?: string;
  /** Deprecated client-supplied question snapshot. Evaluation is rehydrated from the courseware service snapshot. */
  question?: unknown;
  attempt_session_id?: string;
  submission_id?: string;
  answer: CoursewareQuizAnswerContent;
  /** Total required questions in the scene; used by the backend to detect automatically whether the homework is complete. */
  quiz_total_required?: number;
  /** Required question wrapper id list; takes priority over quiz_total_required for the homework completion decision. */
  required_question_wrapper_ids?: string[];
}

type CoursewareQuizSubmitApiError = Error & {
  code?: string;
};

export interface CompleteCoursewareQuizSessionRequest {
  courseware_id?: string;
  attempt_session_id?: string;
  course_id: string;
  section_id: string;
  scene_id?: string;
  total_score: number;
  max_score: number;
  answered_count: number;
  total_count: number;
  required_question_wrapper_ids?: string[];
}

export interface CompleteCoursewareQuizSessionResponse {
  homework_submitted: boolean;
  homework_submitted_at?: string | null;
}

export interface CoursewareQuizAnswerRecord {
  id: string;
  student_id: string;
  section_id: string;
  scene_id?: string | null;
  question_wrapper_id: string;
  slide_element_id?: string | null;
  question_type?: string | null;
  question_title?: string | null;
  answer: CoursewareQuizAnswerContent & Record<string, unknown>;
  score: number;
  max_score: number;
  is_correct: boolean;
  feedback?: string | null;
  feedback_detail?: Record<string, unknown> | null;
  submitted_at: string;
}

export interface ListCoursewareQuizAnswersResponse {
  section_id: string;
  student_id: string;
  answers: CoursewareQuizAnswerRecord[];
}

/** Active submissions for a courseware quiz attempt session (courseware agent). */
export interface CoursewareQuizAttemptAnswerRecord {
  submission_id: string;
  attempt_session_id: string;
  question_id: string;
  question_wrapper_id: string;
  slide_element_id?: string | null;
  question_type?: string | null;
  question_title?: string | null;
  answer: CoursewareQuizAnswerContent & Record<string, unknown>;
  score: number;
  max_score: number;
  passed: boolean;
  can_advance: boolean;
  feedback: string;
  feedback_detail?: Record<string, unknown> | null;
  recording_id?: string | null;
  submitted_at: string;
}

export interface ListCoursewareQuizAttemptAnswersResponse {
  answers: CoursewareQuizAttemptAnswerRecord[];
}

export interface SubmitCoursewareQuizAnswerResponse {
  attempt_session_id?: string;
  submission_id?: string;
  score: number;
  max_score: number;
  raw_score?: number;
  passed: boolean;
  can_advance: boolean;
  feedback: string;
  /** Structured AI scoring payload when available (strengths, explanation, transcription, etc.). */
  feedback_detail?: Record<string, unknown> | null;
  aggregate?: {
    total_score: number;
    max_score: number;
    answered_count: number;
    total_count: number;
    completed: boolean;
  };
}

/**
 * Object key prefixes considered signable by the agent function `normalizeObjectKeyFromInput`.
 * The prefixes 'raw/' and 'artifact/' represent direct OSS links for files uploaded directly by the agent
 * (such as PDF/PPTX conversions or AI-generated images). If these links are present in a scene,
 * a signature (e.g., `?OSSAccessKeyId=...&Signature=...`) must be attached, so they should also be treated as signable here.
 * Old prefixes (like 'courseware_assets/', etc.) are also included as candidates for stripping query strings before persisting.
 */
export {
  COURSEWARE_ASSET_FILE_PATH_PREFIXES as SIGNABLE_FILE_PATH_PREFIXES,
  extractCoursewareAssetFilePath,
  stripCoursewareAssetSignatureFromUrl,
} from "@ainobi/courseware-core";
import {
  extractCoursewareAssetFilePath,
  stripCoursewareAssetSignatureFromUrl,
} from "@ainobi/courseware-core";

const resolveExtension = (fileName: string): CoursewareAssetExtension | null => {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  return COURSEWARE_ASSET_ACCEPTED_EXTENSIONS.includes(ext as CoursewareAssetExtension)
    ? (ext as CoursewareAssetExtension)
    : null;
};

/** Stands in when an organization has no teacher; built on use, since the default model is a host setting. */
const defaultAiTeacher = (): AITeacherInfo => ({
  ai_teacher_id: "00000000-0000-0000-0000-000000000001",
  ai_teacher_no: "default-teacher",
  ai_teacher_name: "默认AI教师",
  ai_teacher_name_kana: null,
  ai_teacher_status: "active",
  ai_teacher_introduction: "内置默认 AI 教师",
  ai_teacher_titles: ["默认"],
  ai_teacher_avatar_url: null,
  ai_teacher_system_prompt: null,
  ai_teacher_llm_provider: "openai",
  ai_teacher_llm_model: null,
  ai_teacher_llm_temperature: null,
  ai_teacher_live2d_model_url: defaultModelUrl() || null,
  ai_teacher_live2d_model_image_url: null,
  ai_teacher_tts_id: null,
  ai_teacher_tts_speed: null,
  ai_teacher_tts_volume: null,
  ai_teacher_tts_pitch: null,
  ai_teacher_tts_language: null,
  ai_teacher_sort: 0,
  remark: "courseware default",
  org_id: "00000000-0000-0000-0000-000000000000",
}) as AITeacherInfo;

const withDefaultAITeacher = (list: AITeacherInfo[]): AITeacherInfo[] => {
  if (list.length === 0) return [defaultAiTeacher()];
  return list;
};

const mapCoursewareAssetInfo = (asset: CoursewareAssetInfo): CoursewareAssetItem | null => {
  const extension = resolveExtension(asset.file_name);
  if (!extension) return null;
  return {
    id: asset.file_id,
    name: asset.file_name,
    url: asset.file_url || asset.file_path,
    extension,
    mimeType: asset.content_type || "application/octet-stream",
    size: asset.file_size,
    createdAt: asset.created_at ?? asset.updated_at ?? "",
  };
};

const stripUndefinedRecord = <T extends Record<string, unknown>>(record: T): Partial<T> => {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) {
      result[key as keyof T] = value as T[keyof T];
    }
  }
  return result;
};

/** The main API `/courseware/quiz/submit_answer` accepts only the old fields; extra keys are refused by validation. */
export const toLegacySubmitQuizAnswerBody = (
  request: SubmitCoursewareQuizAnswerRequest,
): Record<string, unknown> => {
  if (request.question === undefined || request.question === null) {
    throw new Error("缺少 question：主 API 课件测验评测需要题目快照");
  }
  const { skipped: _skipped, ...legacyAnswer } = request.answer;
  return stripUndefinedRecord({
    course_id: request.course_id,
    section_id: request.section_id,
    scene_id: request.scene_id,
    slide_element_id: request.slide_element_id,
    question_wrapper_id: request.question_wrapper_id,
    // Feedback language hint for AI scoring; stripUndefinedRecord drops it when absent.
    language: request.language,
    question: request.question,
    answer: legacyAnswer,
    quiz_total_required: request.quiz_total_required,
    required_question_wrapper_ids: request.required_question_wrapper_ids,
  });
};

/** The main API `/courseware/quiz/complete_session` doesn't accept the courseware service attempt fields. */
const toLegacyCompleteQuizSessionBody = (
  request: CompleteCoursewareQuizSessionRequest,
): Record<string, unknown> =>
  stripUndefinedRecord({
    course_id: request.course_id,
    section_id: request.section_id,
    scene_id: request.scene_id,
    total_score: request.total_score,
    max_score: request.max_score,
    answered_count: request.answered_count,
    total_count: request.total_count,
    required_question_wrapper_ids: request.required_question_wrapper_ids,
  });

export default {
  async createAsset(
    request: CoursewareAssetCreateRequest,
    orgId?: string | null,
  ): Promise<UploadCoursewareAssetResponse> {
    const resolvedOrgId = requireResourceOrgId(orgId ?? "");

    const assetInfo = (await api.post(
      `/organization/${resolvedOrgId}/courseware/asset/create`,
      request,
    )) as CoursewareAssetInfo;

    const asset = mapCoursewareAssetInfo(assetInfo);
    if (!asset) {
      throw new Error(`Unsupported file type: ${assetInfo.file_name}`);
    }
    return { asset, file_path: assetInfo.file_path };
  },
  async getAITeachers(): Promise<GetCoursewareAITeachersResponse> {
    try {
      const response = await api.get("/courseware/ai_teacher/list");
      if (
        response &&
        typeof response === "object" &&
        "ai_teachers" in (response as Record<string, unknown>) &&
        Array.isArray((response as { ai_teachers?: unknown[] }).ai_teachers)
      ) {
        return {
          ai_teachers: withDefaultAITeacher(
            (response as GetCoursewareAITeachersResponse).ai_teachers,
          ),
        };
      }
      if (
        response &&
        typeof response === "object" &&
        "list" in (response as Record<string, unknown>) &&
        Array.isArray((response as { list?: unknown[] }).list)
      ) {
        return {
          ai_teachers: withDefaultAITeacher(
            (response as { list: AITeacherInfo[] }).list,
          ),
        };
      }
      if (Array.isArray(response)) {
        return { ai_teachers: withDefaultAITeacher(response as AITeacherInfo[]) };
      }
      return { ai_teachers: [defaultAiTeacher()] };
    } catch {
      return { ai_teachers: [defaultAiTeacher()] };
    }
  },
  async submitQuizAnswer(
    orgId: string | null | undefined,
    request: SubmitCoursewareQuizAnswerRequest,
  ): Promise<SubmitCoursewareQuizAnswerResponse> {
    const coursewareId = request.courseware_id?.trim();
    if (coursewareId) {
      // courseware-agent: the org is resolved from the courseware/binding, and the client doesn't pass org_id (#65)
      const result = (await coursewareServiceApi.post(
        "/courseware/quiz/evaluate",
        {
          courseware_id: coursewareId,
          course_id: request.course_id,
          section_id: request.section_id,
          scene_id: request.scene_id,
          slide_element_id: request.slide_element_id,
          question_id: request.question_id,
          question_wrapper_id: request.question_wrapper_id,
          language: request.language,
          ...(request.question !== undefined ? { question: request.question } : {}),
          attempt_session_id: request.attempt_session_id,
          submission_id: request.submission_id,
          answer: request.answer,
          quiz_total_required: request.quiz_total_required,
          required_question_wrapper_ids: request.required_question_wrapper_ids,
        },
        {
          responseShape: "agent",
          // Query-level sectionId lets the courseware-service org guard admit
          // enrolled non-members (public-course external students, issue #825).
          ...(request.section_id?.trim()
            ? { query: { sectionId: request.section_id.trim() } }
            : {}),
        },
      )) as {
        ok?: boolean;
        data?: SubmitCoursewareQuizAnswerResponse;
        error?: string;
        error_code?: string;
      };
      if (!result.ok || !result.data) {
        const error = new Error(result.error || "课件测验评测失败") as CoursewareQuizSubmitApiError;
        if (result.error_code) {
          error.code = result.error_code;
        }
        throw error;
      }
      return result.data;
    }
    const resolvedOrgId = orgId?.trim();
    if (!resolvedOrgId) {
      throw new Error("缺少组织 ID：无 courseware_id 时须传入小节所属 orgId");
    }
    // Without courseware_id (editor localStorage / iframe preview etc.), the main API's old evaluation path is used.
    return (await api.post(
      `/organization/${resolvedOrgId}/courseware/quiz/submit_answer`,
      toLegacySubmitQuizAnswerBody(request),
    )) as SubmitCoursewareQuizAnswerResponse;
  },
  async completeQuizSession(
    orgId: string | null | undefined,
    request: CompleteCoursewareQuizSessionRequest,
  ): Promise<CompleteCoursewareQuizSessionResponse> {
    const coursewareId = request.courseware_id?.trim();
    const attemptSessionId = request.attempt_session_id?.trim();
    // courseware-agent: the org is resolved from the courseware/session, so the client may omit org_id (consistent with submitQuizAnswer)
    if (coursewareId && attemptSessionId) {
      const result = (await coursewareServiceApi.post(
        "/courseware/quiz/sessions/complete",
        {
          courseware_id: coursewareId,
          attempt_session_id: attemptSessionId,
        },
        { responseShape: "agent" },
      )) as { ok?: boolean; data?: CompleteCoursewareQuizSessionResponse; error?: string };
      if (!result.ok || !result.data) {
        throw new Error(result.error || "课件测验完成提交失败");
      }
      return result.data;
    }
    const resolvedOrgId = orgId?.trim();
    if (!resolvedOrgId) {
      throw new Error("缺少组织 ID：无 courseware_id 时须传入课时所属 orgId");
    }
    return (await api.post(
      `/organization/${resolvedOrgId}/courseware/quiz/complete_session`,
      toLegacyCompleteQuizSessionBody(request),
    )) as CompleteCoursewareQuizSessionResponse;
  },
  async listQuizAnswers(
    orgId: string,
    params: { sectionId: string; studentId: string },
  ): Promise<ListCoursewareQuizAnswersResponse> {
    const resolvedOrgId = orgId?.trim();
    if (!resolvedOrgId) {
      throw new Error("缺少组织 ID");
    }
    return (await api.get(
      `/organization/${resolvedOrgId}/courseware/quiz/answers`,
      {
        section_id: params.sectionId,
        student_id: params.studentId,
      },
    )) as ListCoursewareQuizAnswersResponse;
  },
  async listQuizAnswersForAttempt(
    orgId: string | null | undefined,
    params: {
      attemptSessionId?: string;
      coursewareId: string;
      sectionId?: string;
    },
  ): Promise<ListCoursewareQuizAttemptAnswersResponse> {
    // courseware-agent GET /courseware/quiz/answers needs no client org; the parameter stays for caller compatibility
    void orgId;
    const coursewareId = params.coursewareId?.trim();
    if (!coursewareId) {
      return { answers: [] };
    }
    const attemptSessionId = params.attemptSessionId?.trim();
    const result = (await coursewareServiceApi.get(
      "/courseware/quiz/answers",
      {
        courseware_id: coursewareId,
        ...(attemptSessionId ? { attempt_session_id: attemptSessionId } : {}),
        ...(params.sectionId?.trim() ? { section_id: params.sectionId.trim() } : {}),
      },
      { responseShape: "agent" },
    )) as { ok?: boolean; data?: ListCoursewareQuizAttemptAnswersResponse; error?: string };
    if (!result.ok || !result.data) {
      throw new Error(result.error || "课件测验作答记录同步失败");
    }
    return result.data;
  },
};
