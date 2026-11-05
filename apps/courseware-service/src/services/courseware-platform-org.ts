// SPDX-License-Identifier: AGPL-3.0-only
import { AinobiCliError } from '@ainobi/courseware-cli/cli/errors.ts';
import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import {
  canAccessCoursewareOrg,
  canAccessOrgAsMember,
  canManageOrg,
  resolveMemberOrgIds,
} from '../auth/ainobi-org-access.ts';
import { assertCanQueryOrgAiTeachers } from './ainobi-ai-teachers.ts';
import { getCoursewareEntityById } from './courseware-service.ts';

export type ResolveCoursewarePlatformOrgInput = {
  courseware_id?: string;
  courseware_org_id?: string;
  org_id?: string;
};

export type ResolveCoursewarePlatformOrgOptions = {
  /**
   * `member` (default): `/organization/list`, suited to read-only catalogs.
   * `manage`: `managed_list`, suited to paths that bill / write storage (e.g. TTS synthesize).
   */
  access?: 'member' | 'manage';
};

export type ResolvedCoursewarePlatformOrg = {
  orgId: string;
  coursewareId?: string;
};

/**
 * Organization ID used by platform APIs (AI teacher list, TTS, billing, etc.).
 * Never falls back to the login session's `current_org_id` (it may differ from the courseware's `org_id`).
 */
export async function resolveCoursewarePlatformOrgId(
  session: AinobiAuthorizedSession,
  input: ResolveCoursewarePlatformOrgInput,
  options: ResolveCoursewarePlatformOrgOptions = {},
): Promise<ResolvedCoursewarePlatformOrg> {
  const access = options.access ?? 'member';
  const coursewareId = input.courseware_id?.trim();
  if (coursewareId) {
    const courseware = await getCoursewareEntityById(coursewareId);
    if (!courseware) {
      throw new AinobiCliError('NOT_FOUND', `Courseware not found: ${coursewareId}`);
    }
    if (access === 'manage') {
      if (!(await canAccessCoursewareOrg(session, courseware))) {
        throw new AinobiCliError('USAGE', 'You do not have access to this courseware.');
      }
    } else {
      // Read-only catalog: either the management side or the member side works.
      const canManage = await canAccessCoursewareOrg(session, courseware);
      const canMember = !canManage && (await canAccessOrgAsMember(session, courseware.orgId));
      if (!canManage && !canMember) {
        throw new AinobiCliError('USAGE', 'You do not have access to this courseware.');
      }
    }
    const orgId = courseware.orgId?.trim();
    if (!orgId) {
      throw new AinobiCliError('USAGE', 'Courseware org_id is not set.');
    }
    return { orgId, coursewareId };
  }

  const orgId = input.courseware_org_id?.trim() || input.org_id?.trim();
  if (orgId) {
    if (access === 'manage') {
      if (!(await canManageOrg(session, orgId))) {
        throw new AinobiCliError(
          'USAGE',
          'You do not have access to AI teachers for this organization',
        );
      }
    } else {
      await assertCanQueryOrgAiTeachers(session.accessToken, orgId, resolveMemberOrgIds);
    }
    return { orgId };
  }

  throw new AinobiCliError(
    'USAGE',
    'Platform organization is required: pass courseware_id or courseware_org_id (login current_org_id is not used).',
  );
}
