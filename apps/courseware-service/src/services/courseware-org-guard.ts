// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage } from 'node:http';

import { getAuthorizedSession, resolveRequestSessionWithPermission } from '../api-auth.ts';
import {
  actorFromSession,
  canAccessCoursewareOrg,
  canAccessOrgAsMember,
  CoursewareOrgAccessError,
  normalizeOrgId,
  type CoursewareActorContext,
} from '../auth/ainobi-org-access.ts';
import {
  COURSE_SECTION_QUERY_PERMISSION,
  hasCourseSectionQueryPermission,
  type AinobiAuthorizedSession,
} from '../auth/ainobi-user-session.ts';
import type { Courseware } from '../models/courseware.ts';
import {
  fetchSectionReadAccess,
  type SectionReadAccessFetcher,
} from './ainobi-section-access.ts';
import {
  findSectionBindingForCoursewareSection,
  isCoursewareBoundInOrg,
} from './courseware-section-binding-service.ts';
import { getCoursewareEntityById } from './courseware-service.ts';

export { CoursewareOrgAccessError };

export type CoursewareAccessMode = 'read' | 'write';

/**
 * Student content endpoints (scene load / quiz scoring / read_text / answer recordings) explicitly enable step ④
 * (the enrolled-section decision). Off by default: render tasks, template extraction and the other read call sites,
 * as well as call sites added in the future, never inherit the pass for non-member enrollees by accident (R8).
 */
export type CoursewareRequestAccessOptions = {
  allowEnrolledSectionRead?: boolean;
};

export function allowsAnonymousCoursewareRead(
  courseware: Pick<Courseware, 'isShare' | 'isPublic'>,
): boolean {
  return Boolean(courseware.isShare || courseware.isPublic);
}

export function allowsAnonymousCoursewareWrite(
  courseware: Pick<Courseware, 'isPublic'>,
): boolean {
  return Boolean(courseware.isPublic);
}

/**
 * Students reading a courseware: they need course_section:query, and the courseware must be bound to a section of their member organization.
 * Organization isolation is decided by the caller from membership of the courseware's org (current_org_id ignored).
 */
export function canReadCoursewareViaSectionBinding(
  session: Pick<AinobiAuthorizedSession, 'permissions'>,
  isBoundInOrg: boolean,
): boolean {
  return hasCourseSectionQueryPermission(session.permissions) && isBoundInOrg;
}

/** Dependency injection point of the step ④ decision (for node:test). */
export type EnrolledSectionAccessDeps = {
  findBinding: (
    coursewareId: string,
    sectionId: string,
  ) => Promise<{ sectionId: string; orgId: string; courseId: string } | null>;
  fetchAccess: SectionReadAccessFetcher;
};

const defaultEnrolledSectionAccessDeps: EnrolledSectionAccessDeps = {
  findBinding: (coursewareId, sectionId) =>
    findSectionBindingForCoursewareSection(coursewareId, sectionId),
  fetchAccess: fetchSectionReadAccess,
};

const SECTION_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parse the sectionId the student declared from the request URL query (for step ④). The frontend appends ?sectionId= to courseware read
 * requests (the existing /courseware/quiz/answers request uses snake_case
 * section_id; both spellings are accepted). Returns null when absent or not a UUID — the binding table's
 * section_id is a uuid column, and an invalid value in the query would make Postgres report 22P02 and become a 500 (R9).
 */
export function resolveRequestSectionId(req: IncomingMessage): string | null {
  try {
    const url = new URL(req.url ?? '/', 'http://internal');
    const raw = url.searchParams.get('sectionId') ?? url.searchParams.get('section_id');
    const trimmed = raw?.trim();
    if (!trimmed || !SECTION_ID_UUID_RE.test(trimmed)) {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Step ④ of a student reading a courseware: the student declares a sectionId on the request; first check the courseware really is
 * bound to that section, then ask the backend `GET /course_section/{id}/info` whether that
 * section is readable for the current user, and allow only when the returned org/course equal the normalized binding row.
 * Covers courseware reads by external students of public courses (enrolled, not organization members, so currentOrgId is never the course's
 * organization) (issue #825). Reachable only on the read path; without a declared sectionId it is always refused.
 */
export async function canReadCoursewareViaEnrolledSection(
  session: Pick<AinobiAuthorizedSession, 'accessToken'>,
  coursewareId: string,
  sectionId: string | null | undefined,
  deps: EnrolledSectionAccessDeps = defaultEnrolledSectionAccessDeps,
): Promise<boolean> {
  const claimedSectionId = sectionId?.trim();
  if (!claimedSectionId) {
    return false;
  }
  // sectionId is client input: it must land on a binding row first, or any section with rights could claim any courseware
  const binding = await deps.findBinding(coursewareId, claimedSectionId);
  if (!binding) {
    return false;
  }
  const access = await deps.fetchAccess(session.accessToken, binding.sectionId);
  if (!access.canRead) {
    return false;
  }
  // The org/course returned by the backend must match the binding row, so another section's readability can't be used to claim it
  if (normalizeOrgId(access.orgId) !== normalizeOrgId(binding.orgId)) {
    return false;
  }
  if (normalizeOrgId(access.courseId) !== normalizeOrgId(binding.courseId)) {
    return false;
  }
  return true;
}

/**
 * Enrollment fallback of binding-list: allowed when the backend decides the section the request points at is readable for the current user,
 * and the returned org (and the course, when the request carries a courseId) equal the normalized request parameters.
 * The fallback for GET /courseware/section-binding/list after assertOrgIdAccess 403s.
 */
export async function canListSectionBindingsViaEnrolledSection(
  session: Pick<AinobiAuthorizedSession, 'accessToken'>,
  params: { sectionId: string; orgId: string; courseId?: string | null },
  fetchAccess: SectionReadAccessFetcher = fetchSectionReadAccess,
): Promise<boolean> {
  const access = await fetchAccess(session.accessToken, params.sectionId);
  if (!access.canRead) {
    return false;
  }
  if (normalizeOrgId(access.orgId) !== normalizeOrgId(params.orgId)) {
    return false;
  }
  const courseId = params.courseId?.trim();
  if (courseId && normalizeOrgId(access.courseId) !== normalizeOrgId(courseId)) {
    return false;
  }
  return true;
}

export function requireAuthorizedSession(req: IncomingMessage): AinobiAuthorizedSession {
  const session = getAuthorizedSession(req);
  if (!session) {
    throw new Error('Unauthorized');
  }
  return session;
}

/** Org manage (managed_list), or anonymous read/write per `is_share` / `is_public`. */
export async function assertCoursewareRequestAccess(
  session: AinobiAuthorizedSession,
  courseware: Pick<Courseware, 'orgId' | 'isShare' | 'isPublic'>,
  mode: CoursewareAccessMode,
): Promise<void> {
  if (await canAccessCoursewareOrg(session, courseware)) {
    return;
  }
  if (mode === 'read' && allowsAnonymousCoursewareRead(courseware)) {
    return;
  }
  if (mode === 'write' && allowsAnonymousCoursewareWrite(courseware)) {
    return;
  }
  throw new CoursewareOrgAccessError();
}

export async function loadCoursewareWithRequestAccess(
  req: IncomingMessage,
  idOrKey: string,
  mode: CoursewareAccessMode,
  opts?: CoursewareRequestAccessOptions,
): Promise<{ courseware: Courseware; session: AinobiAuthorizedSession | null }> {
  const cw = await getCoursewareEntityById(idOrKey);
  if (!cw) {
    throw new Error('courseware not found');
  }
  return resolveCoursewareRequestAccess(req, cw, mode, opts);
}

/**
 * Authorize against a courseware row the caller **has already resolved**. The only difference from loadCoursewareWithRequestAccess is that
 * it doesn't query the DB itself: a caller that will later write by this row must use this entry, otherwise "checking existence" and "writing"
 * would each look it up and could get different rows (?key= may be a key or another row's id).
 */
export async function resolveCoursewareRequestAccess(
  req: IncomingMessage,
  cw: Courseware,
  mode: CoursewareAccessMode,
  opts?: CoursewareRequestAccessOptions,
): Promise<{ courseware: Courseware; session: AinobiAuthorizedSession | null }> {
  const session = getAuthorizedSession(req);
  if (session && (await canAccessCoursewareOrg(session, cw))) {
    return { courseware: cw, session };
  }

  if (mode === 'read' && allowsAnonymousCoursewareRead(cw)) {
    return { courseware: cw, session: null };
  }
  if (mode === 'write' && allowsAnonymousCoursewareWrite(cw)) {
    return { courseware: cw, session: null };
  }

  if (mode === 'read') {
    const learnerSession = await resolveRequestSessionWithPermission(
      req,
      COURSE_SECTION_QUERY_PERMISSION,
    );
    if (learnerSession) {
      // ③ Organization member students: must be members of the courseware's org, and the courseware must be bound to a section of that org.
      //    current_org_id is no longer used as an access gate.
      const bindOrgId = normalizeOrgId(cw.orgId);
      const isMember = bindOrgId
        ? await canAccessOrgAsMember(learnerSession, bindOrgId)
        : false;
      const bound =
        isMember && bindOrgId ? await isCoursewareBoundInOrg(cw.id, bindOrgId) : false;
      if (canReadCoursewareViaSectionBinding(learnerSession, bound)) {
        return { courseware: cw, session: learnerSession };
      }
      // ④ Enrolled students (including external students of public courses, not organization members): allowed when the declared sectionId
      //    really is bound to the courseware and the backend decides that section is readable for them.
      //    Explicitly enabled only on student content endpoints (R8).
      if (opts?.allowEnrolledSectionRead) {
        const claimedSectionId = resolveRequestSectionId(req);
        if (await canReadCoursewareViaEnrolledSection(learnerSession, cw.id, claimedSectionId)) {
          return { courseware: cw, session: learnerSession };
        }
      }
      throw new CoursewareOrgAccessError();
    }
  }

  if (session) {
    throw new CoursewareOrgAccessError();
  }
  throw new Error('Unauthorized');
}

export async function loadCoursewareAndAssertOrgAccess(
  session: AinobiAuthorizedSession,
  idOrKey: string,
): Promise<Courseware> {
  const cw = await getCoursewareEntityById(idOrKey);
  if (!cw) {
    throw new Error('courseware not found');
  }
  if (!(await canAccessCoursewareOrg(session, cw))) {
    throw new CoursewareOrgAccessError();
  }
  return cw;
}

export async function loadCoursewareByIdAndAssertOrgAccess(
  session: AinobiAuthorizedSession,
  coursewareId: string,
): Promise<Courseware> {
  const cw = await getCoursewareEntityById(coursewareId);
  if (!cw) {
    throw new Error('courseware not found');
  }
  if (!(await canAccessCoursewareOrg(session, cw))) {
    throw new CoursewareOrgAccessError();
  }
  return cw;
}

export async function loadCoursewareByIdWithRequestAccess(
  req: IncomingMessage,
  coursewareId: string,
  mode: CoursewareAccessMode,
  opts?: CoursewareRequestAccessOptions,
): Promise<{ courseware: Courseware; session: AinobiAuthorizedSession | null }> {
  return loadCoursewareWithRequestAccess(req, coursewareId, mode, opts);
}

/** Whether the requesting user has organization management rights over the courseware (same as write operations such as PUT/DELETE). */
export async function resolveCoursewareCanManage(
  req: IncomingMessage,
  courseware: Pick<Courseware, 'orgId'>,
): Promise<boolean> {
  const session = getAuthorizedSession(req);
  if (!session) {
    return false;
  }
  return canAccessCoursewareOrg(session, courseware);
}

export function resolveActor(req: IncomingMessage): CoursewareActorContext | null {
  const session = getAuthorizedSession(req);
  return session ? actorFromSession(session) : null;
}

export function resolveActorOrThrow(req: IncomingMessage): CoursewareActorContext {
  return actorFromSession(requireAuthorizedSession(req));
}
