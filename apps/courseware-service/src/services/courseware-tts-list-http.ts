// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from 'node:http';

import { AinobiCliError } from '@ainobi/courseware-cli/cli/errors.ts';
import { requireRequestSession } from '../api-auth.ts';
import { sendJsonWithCors } from '../http/cors.ts';
import { readJsonBody } from '../http/request.ts';
import {
  assertCanQueryOrgTts,
  fetchOrgTtsFromPlatform,
} from './ainobi-tts.ts';
import { resolveCoursewarePlatformOrgId } from './courseware-platform-org.ts';

type TtsListBody = {
  org_id?: string;
  courseware_id?: string;
  courseware_org_id?: string;
  page_size?: number;
  fetch_all_pages?: boolean;
  tts_provider?: string;
  tts_language?: string;
  tts_status?: string;
};

/**
 * POST `/courseware/tts/list` — agent CLI lists platform TTS catalog via the host.
 */
export async function handleCoursewareTtsList(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let session;
  try {
    // A catalog members can read: doesn't depend on the global manage-only authorizeRequest
    session = await requireRequestSession(req);
  } catch {
    sendJsonWithCors(res, 401, { ok: false, error: 'Unauthorized' });
    return;
  }

  let raw: TtsListBody = {};
  try {
    if (req.method === 'POST') {
      raw = await readJsonBody<TtsListBody>(req);
    }
  } catch (error) {
    sendJsonWithCors(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const hasOrgInput = Boolean(
    raw.courseware_id?.trim() || raw.courseware_org_id?.trim() || raw.org_id?.trim(),
  );

  let orgId = '';
  try {
    const resolved = await resolveCoursewarePlatformOrgId(session, {
      courseware_id: raw.courseware_id,
      courseware_org_id: raw.courseware_org_id ?? raw.org_id,
      org_id: raw.org_id,
    });
    orgId = resolved.orgId;
  } catch (error) {
    // Never falls back to the session's current_org. Only the deployment-level AINOBI_COURSEWARE_ORG_ID (CLI host) is allowed.
    if (error instanceof AinobiCliError && error.code === 'USAGE' && !hasOrgInput) {
      orgId = process.env.AINOBI_COURSEWARE_ORG_ID?.trim() || '';
    } else {
      const message = error instanceof Error ? error.message : String(error);
      const status =
        error instanceof AinobiCliError && error.code === 'NOT_FOUND'
          ? 404
          : /do not have access/i.test(message)
            ? 403
            : error instanceof AinobiCliError
              ? 400
              : 502;
      sendJsonWithCors(res, status, {
        ok: false,
        error: message,
      });
      return;
    }
  }

  if (!orgId) {
    sendJsonWithCors(res, 400, {
      ok: false,
      error:
        'Organization context is required to list TTS voices (pass courseware_id / courseware_org_id / org_id; login current_org_id is not used).',
    });
    return;
  }

  try {
    await assertCanQueryOrgTts(session.accessToken, orgId);
  } catch (error) {
    sendJsonWithCors(res, 403, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  try {
    const result = await fetchOrgTtsFromPlatform(session.accessToken, orgId, {
      pageSize: raw.page_size,
      fetchAllPages: raw.fetch_all_pages !== false,
      ttsProvider: raw.tts_provider,
      ttsLanguage: raw.tts_language,
      ttsStatus: raw.tts_status,
    });
    sendJsonWithCors(res, 200, {
      ok: true,
      data: {
        source: 'platform',
        org_id: result.orgId,
        voices: result.voices,
        tts_list: result.voices,
        count: result.voices.length,
        total_count: result.totalCount,
      },
    });
  } catch (error) {
    sendJsonWithCors(res, 502, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
