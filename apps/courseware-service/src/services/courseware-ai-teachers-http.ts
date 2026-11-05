// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from 'node:http';

import { AinobiCliError } from '@ainobi/courseware-cli/cli/errors.ts';
import { resolveMemberOrgIds } from '../auth/ainobi-org-access.ts';
import { requireRequestSession } from '../api-auth.ts';
import { sendJsonWithCors } from '../http/cors.ts';
import { readJsonBody } from '../http/request.ts';
import {
  assertCanQueryOrgAiTeachers,
  builtinAiTeachers,
  fetchOrgAiTeachersFromPlatform,
} from './ainobi-ai-teachers.ts';
import { resolveCoursewarePlatformOrgId } from './courseware-platform-org.ts';

type AiTeachersListBody = {
  org_id?: string;
  courseware_id?: string;
  courseware_org_id?: string;
  page_size?: number;
  fetch_all_pages?: boolean;
  ai_teacher_status?: string;
};

/**
 * POST `/courseware/ai-teachers/list` — agent CLI lists org AI teachers via the host (sync HTTP).
 * Without `org_id`, returns the built-in default catalog.
 */
export async function handleCoursewareAiTeachersList(
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

  let raw: AiTeachersListBody = {};
  try {
    if (req.method === 'POST') {
      raw = await readJsonBody<AiTeachersListBody>(req);
    }
  } catch (error) {
    sendJsonWithCors(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  let orgId = '';
  try {
    const resolved = await resolveCoursewarePlatformOrgId(session, {
      courseware_id: raw.courseware_id,
      courseware_org_id: raw.courseware_org_id ?? raw.org_id,
      org_id: raw.org_id,
    });
    orgId = resolved.orgId;
  } catch (error) {
    if (error instanceof AinobiCliError && error.code === 'USAGE') {
      orgId = process.env.AINOBI_COURSEWARE_ORG_ID?.trim() || '';
    } else {
      const status =
        error instanceof AinobiCliError && error.code === 'NOT_FOUND'
          ? 404
          : error instanceof AinobiCliError
            ? 400
            : 502;
      sendJsonWithCors(res, status, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  }

  if (!orgId) {
    const teachers = [...builtinAiTeachers()];
    sendJsonWithCors(res, 200, {
      ok: true,
      data: {
        source: 'builtin',
        org_id: null,
        teachers,
        ai_teachers: teachers,
        count: teachers.length,
        total_count: teachers.length,
      },
    });
    return;
  }

  try {
    await assertCanQueryOrgAiTeachers(session.accessToken, orgId, resolveMemberOrgIds);
  } catch (error) {
    sendJsonWithCors(res, 403, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  try {
    const result = await fetchOrgAiTeachersFromPlatform(session.accessToken, orgId, {
      pageSize: raw.page_size,
      fetchAllPages: raw.fetch_all_pages !== false,
      aiTeacherStatus: raw.ai_teacher_status,
    });
    sendJsonWithCors(res, 200, {
      ok: true,
      data: {
        source: 'platform',
        org_id: result.orgId,
        teachers: result.teachers,
        ai_teachers: result.teachers,
        count: result.teachers.length,
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
