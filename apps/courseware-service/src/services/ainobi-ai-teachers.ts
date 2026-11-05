// SPDX-License-Identifier: AGPL-3.0-only
import { ainobiBackendApiUrl } from '../config/ainobi-backend-api.ts';
import {
  DEFAULT_AI_TEACHERS,
  normalizeTeacherList,
  normalizeTtsProvider,
  type AITeacher,
} from '@ainobi/courseware-cli/cli/ai-teachers.ts';

type PlatformAiTeacherTtsRow = {
  tts_provider?: string | null;
  tts_model?: string | null;
  tts_voice?: string | null;
};

type PlatformAiTeacherRow = {
  ai_teacher_id?: string;
  ai_teacher_name?: string;
  ai_teacher_status?: string;
  ai_teacher_avatar_url?: string | null;
  ai_teacher_live2d_model_url?: string | null;
  ai_teacher_live2d_model_image_url?: string | null;
  ai_teacher_tts_id?: string | null;
  ai_teacher_tts_style?: string | null;
  ai_teacher_tts_style_prompt?: string | null;
  ai_teacher_tts?: PlatformAiTeacherTtsRow | null;
  ai_teacher_tts_speed?: number | null;
  ai_teacher_tts_volume?: number | null;
  ai_teacher_tts_pitch?: number | null;
  ai_teacher_language?: string | null;
};

type PlatformPaginatedData = {
  data?: PlatformAiTeacherRow[];
  pagination?: {
    page_number?: number;
    page_size?: number;
    total_count?: number;
    total_pages?: number;
    has_next_page?: boolean;
    has_previous_page?: boolean;
  };
};

type PlatformListResponse = {
  code?: number;
  success?: boolean;
  message?: string;
  data?: PlatformPaginatedData;
};

export type FetchOrgAiTeachersOptions = {
  pageSize?: number;
  /** When true (default), follow pagination until all rows are loaded. */
  fetchAllPages?: boolean;
  /** Default `active` — only teachers usable for courseware narration. */
  aiTeacherStatus?: string;
};

export type FetchOrgAiTeachersResult = {
  teachers: AITeacher[];
  orgId: string;
  totalCount: number;
};

export function builtinAiTeachers(): readonly AITeacher[] {
  return DEFAULT_AI_TEACHERS;
}

export function mapPlatformAiTeacherRow(row: PlatformAiTeacherRow): AITeacher | null {
  const id = row.ai_teacher_id?.trim();
  const name = row.ai_teacher_name?.trim();
  if (!id || !name) {
    return null;
  }

  const fallback = DEFAULT_AI_TEACHERS[0];
  const fallbackModelUrl = fallback?.ai_teacher_live2d_model_url?.trim() || '';
  const hasPlatformLive2dModel = Boolean(row.ai_teacher_live2d_model_url?.trim());
  const usedLive2dFallback = !hasPlatformLive2dModel && Boolean(fallbackModelUrl);
  const modelUrl = hasPlatformLive2dModel
    ? row.ai_teacher_live2d_model_url!.trim()
    : fallbackModelUrl;

  const teacher: AITeacher = {
    ai_teacher_id: id,
    ai_teacher_name: name,
    runtime: 'live2d',
    model_url: modelUrl,
    ai_teacher_avatar_url: usedLive2dFallback
      ? fallback?.ai_teacher_avatar_url?.trim() || ''
      : row.ai_teacher_avatar_url?.trim() || '',
    ai_teacher_live2d_model_url: modelUrl,
    ai_teacher_live2d_model_image_url: usedLive2dFallback
      ? fallback?.ai_teacher_live2d_model_image_url?.trim() || fallbackModelUrl
      : row.ai_teacher_live2d_model_image_url?.trim() ||
        row.ai_teacher_avatar_url?.trim() ||
        modelUrl,
  };

  const ttsId = row.ai_teacher_tts_id?.trim();
  const ttsStyle = row.ai_teacher_tts_style?.trim();
  const ttsStylePrompt = row.ai_teacher_tts_style_prompt?.trim();
  if (ttsId) {
    teacher.ai_teacher_tts_id = ttsId;
  }
  // The style field is independent of tts_id: teachers without a tts_id (nested/default voice) keep their configured style too
  if (ttsStyle) teacher.ai_teacher_tts_style = ttsStyle;
  if (ttsStylePrompt) teacher.ai_teacher_tts_style_prompt = ttsStylePrompt;
  const nestedTts = row.ai_teacher_tts;
  if (nestedTts && typeof nestedTts === 'object') {
    const provider = normalizeTtsProvider(nestedTts.tts_provider);
    if (provider) {
      teacher.ai_teacher_tts_provider = provider;
    }
    const model = nestedTts.tts_model?.trim();
    if (model) {
      teacher.ai_teacher_tts_model = model;
    }
    const voice = nestedTts.tts_voice?.trim();
    if (voice) {
      teacher.ai_teacher_tts_voice = voice;
    }
  }
  if (row.ai_teacher_tts_speed != null && Number.isFinite(row.ai_teacher_tts_speed)) {
    teacher.ai_teacher_tts_speed = row.ai_teacher_tts_speed;
  }
  if (row.ai_teacher_tts_volume != null && Number.isFinite(row.ai_teacher_tts_volume)) {
    teacher.ai_teacher_tts_volume = row.ai_teacher_tts_volume;
  }
  if (row.ai_teacher_tts_pitch != null && Number.isFinite(row.ai_teacher_tts_pitch)) {
    teacher.ai_teacher_tts_pitch = row.ai_teacher_tts_pitch;
  }
  const language = row.ai_teacher_language?.trim();
  if (language) {
    teacher.ai_teacher_language = language;
  }

  return teacher;
}

export async function assertCanQueryOrgAiTeachers(
  accessToken: string,
  targetOrgId: string,
  resolveMemberOrgIds: (token: string) => Promise<Set<string>>,
): Promise<void> {
  const orgId = targetOrgId.trim().toLowerCase();
  if (!orgId) {
    throw new Error('Organization context is required to query AI teachers');
  }
  const member = await resolveMemberOrgIds(accessToken);
  if (!member.has(orgId)) {
    throw new Error('You do not have access to AI teachers for this organization');
  }
}

export async function fetchOrgAiTeachersFromPlatform(
  accessToken: string,
  orgId: string,
  options: FetchOrgAiTeachersOptions = {},
): Promise<FetchOrgAiTeachersResult> {
  const normalizedOrgId = orgId.trim();
  if (!normalizedOrgId) {
    throw new Error('orgId is required');
  }

  const pageSize = Math.min(Math.max(options.pageSize ?? 100, 1), 500);
  const fetchAllPages = options.fetchAllPages !== false;
  const status = (options.aiTeacherStatus ?? 'active').trim();

  const teachers: AITeacher[] = [];
  let pageNumber = 1;
  let totalCount = 0;

  for (let guard = 0; guard < 100; guard += 1) {
    const requestUrl = new URL(
      ainobiBackendApiUrl(`/organization/${encodeURIComponent(normalizedOrgId)}/ai_teacher/list`),
    );
    requestUrl.searchParams.set('page_number', String(pageNumber));
    requestUrl.searchParams.set('page_size', String(pageSize));
    if (status) {
      requestUrl.searchParams.set('ai_teacher_status', status);
    }

    let response: Response;
    try {
      response = await fetch(requestUrl, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: 'application/json',
        },
      });
    } catch (error) {
      throw new Error(
        `AI teacher list request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let body: PlatformListResponse;
    try {
      body = (await response.json()) as PlatformListResponse;
    } catch {
      throw new Error('AI teacher list returned invalid JSON');
    }

    if (!response.ok || body.code !== 0 || body.success !== true || !body.data) {
      throw new Error(body.message?.trim() || `AI teacher list rejected (HTTP ${response.status})`);
    }

    const rows = body.data.data ?? [];
    for (const row of rows) {
      const teacher = mapPlatformAiTeacherRow(row);
      if (teacher) {
        teachers.push(teacher);
      }
    }

    const pagination = body.data.pagination;
    if (typeof pagination?.total_count === 'number') {
      totalCount = pagination.total_count;
    } else if (pageNumber === 1) {
      totalCount = teachers.length;
    }

    const hasNext = pagination?.has_next_page === true;
    if (!fetchAllPages || !hasNext || rows.length === 0) {
      break;
    }
    pageNumber += 1;
  }

  if (totalCount === 0) {
    totalCount = teachers.length;
  }

  return {
    teachers,
    orgId: normalizedOrgId,
    totalCount,
  };
}

/** Normalize host/CLI JSON payloads into {@link AITeacher} records. */
export function normalizeAiTeachersPayload(value: unknown): AITeacher[] {
  if (Array.isArray(value)) {
    return normalizeTeacherList(value);
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as { teachers?: unknown; ai_teachers?: unknown };
    return normalizeTeacherList(record.teachers ?? record.ai_teachers ?? value);
  }
  return [];
}
