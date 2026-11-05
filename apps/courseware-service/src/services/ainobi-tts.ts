// SPDX-License-Identifier: AGPL-3.0-only
import { ainobiBackendApiUrl } from '../config/ainobi-backend-api.ts';
import { resolveMemberOrgIds } from '../auth/ainobi-org-access.ts';
import { assertCanQueryOrgAiTeachers } from './ainobi-ai-teachers.ts';

import {
  normalizeTtsVoice,
  normalizeTtsVoiceList,
  type PlatformTtsVoice,
} from '@ainobi/courseware-cli/cli/tts-catalog.ts';

type PlatformPaginatedData = {
  data?: unknown[];
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

type PlatformInfoResponse = {
  code?: number;
  success?: boolean;
  message?: string;
  data?: unknown;
};

export type FetchOrgTtsOptions = {
  pageSize?: number;
  fetchAllPages?: boolean;
  ttsProvider?: string;
  ttsLanguage?: string;
  ttsStatus?: string;
};

export type FetchOrgTtsResult = {
  voices: PlatformTtsVoice[];
  orgId: string;
  totalCount: number;
};

export async function fetchOrgTtsFromPlatform(
  accessToken: string,
  orgId: string,
  options: FetchOrgTtsOptions = {},
): Promise<FetchOrgTtsResult> {
  const normalizedOrgId = orgId.trim();
  if (!normalizedOrgId) {
    throw new Error('orgId is required');
  }

  const fetchAllPages = options.fetchAllPages !== false;
  // A full fetch defaults to the 500-per-page maximum: the voice catalog has 900+ entries, and 100 per page would need 10 serial requests.
  const pageSize = Math.min(Math.max(options.pageSize ?? (fetchAllPages ? 500 : 100), 1), 500);
  const status = (options.ttsStatus ?? 'active').trim();
  const provider = options.ttsProvider?.trim() || '';
  const language = options.ttsLanguage?.trim() || '';

  const voices: PlatformTtsVoice[] = [];
  let pageNumber = 1;
  let totalCount = 0;

  for (let guard = 0; guard < 100; guard += 1) {
    const requestUrl = new URL(
      ainobiBackendApiUrl(`/organization/${encodeURIComponent(normalizedOrgId)}/tts/list`),
    );
    requestUrl.searchParams.set('page_number', String(pageNumber));
    requestUrl.searchParams.set('page_size', String(pageSize));
    if (status) {
      requestUrl.searchParams.set('tts_status', status);
    }
    if (provider) {
      requestUrl.searchParams.set('tts_provider', provider);
    }
    if (language) {
      requestUrl.searchParams.set('tts_language', language);
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
        `TTS list request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let body: PlatformListResponse;
    try {
      body = (await response.json()) as PlatformListResponse;
    } catch {
      throw new Error('TTS list returned invalid JSON');
    }

    if (!response.ok || body.code !== 0 || body.success !== true || !body.data) {
      throw new Error(body.message?.trim() || `TTS list rejected (HTTP ${response.status})`);
    }

    const rawRows = body.data.data ?? [];
    const rows = normalizeTtsVoiceList(rawRows);
    voices.push(...rows);

    const pagination = body.data.pagination;
    if (typeof pagination?.total_count === 'number') {
      totalCount = pagination.total_count;
    } else if (pageNumber === 1) {
      totalCount = voices.length;
    }

    // Use raw page length (not post-normalize count) so a page of incomplete rows
    // does not stop pagination while has_next_page is still true.
    const hasNext = pagination?.has_next_page === true;
    if (!fetchAllPages || !hasNext || rawRows.length === 0) {
      break;
    }
    pageNumber += 1;
  }

  if (totalCount === 0) {
    totalCount = voices.length;
  }

  return {
    voices,
    orgId: normalizedOrgId,
    totalCount,
  };
}


export async function fetchOrgTtsByIdFromPlatform(
  accessToken: string,
  orgId: string,
  ttsId: string,
): Promise<PlatformTtsVoice> {
  const normalizedOrgId = orgId.trim();
  const id = ttsId.trim();
  if (!normalizedOrgId || !id) {
    throw new Error('orgId and ttsId are required');
  }

  const requestUrl = ainobiBackendApiUrl(
    `/organization/${encodeURIComponent(normalizedOrgId)}/tts/${encodeURIComponent(id)}/info`,
  );

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
      `TTS info request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let body: PlatformInfoResponse;
  try {
    body = (await response.json()) as PlatformInfoResponse;
  } catch {
    throw new Error('TTS info returned invalid JSON');
  }

  if (!response.ok || body.code !== 0 || body.success !== true || !body.data) {
    throw new Error(body.message?.trim() || `TTS info rejected (HTTP ${response.status})`);
  }

  const voice = normalizeTtsVoice(body.data);
  if (!voice) {
    throw new Error(`TTS voice not found or incomplete: ${id}`);
  }
  return voice;
}

export async function assertCanQueryOrgTts(
  accessToken: string,
  targetOrgId: string,
  resolveOrgIds: (token: string) => Promise<Set<string>> = resolveMemberOrgIds,
): Promise<void> {
  // Default: member list for catalog reads. Billed paths pass resolveManagedOrgIds.
  await assertCanQueryOrgAiTeachers(accessToken, targetOrgId, resolveOrgIds);
}
