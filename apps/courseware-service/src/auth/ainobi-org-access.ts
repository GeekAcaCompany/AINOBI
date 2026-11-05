// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';

import { ainobiBackendApiUrl } from '../config/ainobi-backend-api.ts';
import {
  isOrgAgentSession,
  type AinobiAuthorizedSession,
} from './ainobi-user-session.ts';
import { redisClient } from '../db/db.ts';
import type { Courseware } from '../models/courseware.ts';

const MANAGED_ORGS_CACHE_KEY_PREFIX = 'ainobi-courseware-agent:managed-orgs:v2:';
const MEMBER_ORGS_CACHE_KEY_PREFIX = 'ainobi-courseware-agent:member-orgs:v1:';

/**
 * Org id normalization: Postgres uuid columns come back in canonical lowercase, while org ids in client body/query and backend
 * JSON may be uppercase or mixed case (both `z.uuid()` and Postgres accept them).
 * Every org equality comparison must go through here, or the same organization would be judged cross-organization.
 */
export function normalizeOrgId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

const DEFAULT_ORG_LIST_CACHE_TTL_SECONDS = 300;

function orgListCacheTtlSeconds(): number {
  const n = Number(
    process.env.AINOBI_ORG_MANAGED_LIST_CACHE_TTL_SECONDS ?? DEFAULT_ORG_LIST_CACHE_TTL_SECONDS,
  );
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_ORG_LIST_CACHE_TTL_SECONDS;
}

function tokenDigest(accessToken: string): string {
  return createHash('sha256').update(accessToken, 'utf8').digest('hex');
}

function managedOrgsCacheKey(accessToken: string): string {
  return `${MANAGED_ORGS_CACHE_KEY_PREFIX}${tokenDigest(accessToken)}`;
}

function memberOrgsCacheKey(accessToken: string): string {
  return `${MEMBER_ORGS_CACHE_KEY_PREFIX}${tokenDigest(accessToken)}`;
}

/**
 * Force-drop the cached managed/member org sets for this token.
 *
 * Self-healing for role changes that land BETWEEN cache writes — typically:
 * a just-created/just-granted organization whose cache still holds the old set, so the gate would wrongly say "not a member".
 * Callers re-probe once after invalidation; the fresh fetch repopulates.
 */
export async function invalidateCachedOrgIds(accessToken: string): Promise<void> {
  const token = accessToken.trim();
  if (!token) {
    return;
  }
  try {
    await redisClient.del(managedOrgsCacheKey(token), memberOrgsCacheKey(token));
  } catch (error) {
    console.warn(
      '[auth] org-list cache invalidate failed (non-fatal):',
      error instanceof Error ? error.message : error,
    );
  }
}

type OrgListApiOrg = {
  org_id?: string;
};

type OrgListApiPagination = {
  page_number?: number;
  page_size?: number;
  has_next_page?: boolean;
};

type OrgListApiData = {
  data?: OrgListApiOrg[];
  pagination?: OrgListApiPagination;
};

type OrgListApiResponse = {
  code?: number;
  success?: boolean;
  message?: string;
  data?: OrgListApiData;
};

async function readCachedOrgIds(cacheKey: string): Promise<Set<string> | null> {
  try {
    const raw = await redisClient.get(cacheKey);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { orgIds?: string[] };
    if (!Array.isArray(parsed.orgIds)) {
      return null;
    }
    return new Set(
      parsed.orgIds
        .map((id) => (typeof id === 'string' ? normalizeOrgId(id) : null))
        .filter((id): id is string => Boolean(id)),
    );
  } catch (error) {
    console.warn(
      '[auth] Redis org-list cache read failed:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

async function writeCachedOrgIds(cacheKey: string, orgIds: Set<string>): Promise<void> {
  try {
    await redisClient.set(
      cacheKey,
      JSON.stringify({ orgIds: [...orgIds] }),
      'EX',
      orgListCacheTtlSeconds(),
    );
  } catch (error) {
    console.warn(
      '[auth] Redis org-list cache write failed:',
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Fetch the backend organization list page by page (`/organization/list` or `/organization/managed_list`).
 * The response envelope is the same: `data.data[].org_id` + `pagination.has_next_page`.
 */
/**
 * Agent-session fallback for the org probes: the human-only
 * `/organization/list|managed_list` reject agent tokens (403011), so an
 * agent resolves the orgs bound to its ACTIVE credentials (backend derives
 * them from `agent_credential`, NOT from session current_org_id — the
 * contract follows the credential relationship and may span multiple orgs).
 * Returns an empty set for anything that is not a live agent session —
 * callers then rethrow the original error. */
async function fetchAgentCredentialOrgIds(accessToken: string): Promise<Set<string>> {
  try {
    const response = await fetch(ainobiBackendApiUrl("/agent/orgs"), {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
      },
    });
    if (!response.ok) {
      return new Set();
    }
    // agent_token_router returns a bare List[OrganizationInfo] (no Success envelope).
    const body = (await response.json()) as Array<{ org_id?: string }>;
    const orgIds = new Set<string>();
    for (const row of Array.isArray(body) ? body : []) {
      const orgId = normalizeOrgId(row.org_id ?? "");
      if (orgId) {
        orgIds.add(orgId);
      }
    }
    return orgIds;
  } catch {
    return new Set();
  }
}

async function fetchOrgIdsFromApi(accessToken: string, apiPath: string): Promise<Set<string>> {
  const url = ainobiBackendApiUrl(apiPath);

  const orgIds = new Set<string>();
  let pageNumber = 1;
  const pageSize = 100;

  for (let guard = 0; guard < 50; guard += 1) {
    const requestUrl = new URL(url);
    requestUrl.searchParams.set('page_number', String(pageNumber));
    requestUrl.searchParams.set('page_size', String(pageSize));

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
        `${apiPath} request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let body: OrgListApiResponse;
    try {
      body = (await response.json()) as OrgListApiResponse;
    } catch {
      throw new Error(`${apiPath} returned non-JSON (status ${response.status})`);
    }

    if (!response.ok || body.code !== 0 || body.success !== true || !body.data) {
      // Agent tokens are deliberately rejected by the human-only org lists
      // (403011 — agents hold no role rows). Resolve their single credential
      // org via the agent-scoped endpoint instead.
      if (response.status === 403) {
        const agentOrgIds = await fetchAgentCredentialOrgIds(accessToken);
        if (agentOrgIds.size > 0) {
          for (const agentOrgId of agentOrgIds) {
            orgIds.add(agentOrgId);
          }
          return orgIds;
        }
      }
      throw new Error(`${apiPath} rejected: ${body.message ?? response.status}`);
    }

    for (const row of body.data.data ?? []) {
      const orgId = normalizeOrgId(row.org_id);
      if (orgId) {
        orgIds.add(orgId);
      }
    }

    const pagination = body.data.pagination;
    if (!pagination?.has_next_page) {
      return orgIds;
    }
    pageNumber += 1;
  }

  return orgIds;
}

async function resolveCachedOrgIds(
  accessToken: string,
  cacheKey: string,
  apiPath: string,
  logLabel: string,
): Promise<Set<string>> {
  const token = accessToken.trim();
  if (!token) {
    return new Set();
  }

  const cached = await readCachedOrgIds(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const orgIds = await fetchOrgIdsFromApi(token, apiPath);
    // Only successful responses (including a valid empty set) are cached; failures are not, so a transient error isn't pinned into minutes of 403
    await writeCachedOrgIds(cacheKey, orgIds);
    return orgIds;
  } catch (error) {
    console.warn(
      `[auth] ${logLabel} failed (not cached):`,
      error instanceof Error ? error.message : error,
    );
    return new Set();
  }
}

/**
 * Set of organization ids the user can manage (teacher+; `GET /organization/managed_list`).
 * For write operations / edit permission; excludes organizations where the user is only a student member.
 */
export async function resolveManagedOrgIds(accessToken: string): Promise<Set<string>> {
  return resolveCachedOrgIds(
    accessToken,
    managedOrgsCacheKey(accessToken),
    '/organization/managed_list',
    'resolveManagedOrgIds',
  );
}

/**
 * Set of organization ids the user belongs to (students included; `GET /organization/list`).
 * For read/query organization isolation; doesn't depend on the login session's current_org_id.
 */
export async function resolveMemberOrgIds(accessToken: string): Promise<Set<string>> {
  return resolveCachedOrgIds(
    accessToken,
    memberOrgsCacheKey(accessToken),
    '/organization/list',
    'resolveMemberOrgIds',
  );
}

export class CoursewareOrgAccessError extends Error {
  readonly status = 403;

  constructor(message = 'Forbidden: no access to this organization courseware') {
    super(message);
    this.name = 'CoursewareOrgAccessError';
  }
}

/**
 * Single-org invariant: a courseware belongs to exactly one organization, and the orgId of a section/course binding must equal
 * the courseware's own org_id — reusing a courseware across organizations goes through clone; binding the same courseware into
 * a second organization is not allowed. The org is set only when the courseware is created (the create entry requires orgId), and is never
 * rewritten afterwards nor inferred from bindings/login state: a courseware with an empty org (only possible for legacy rows) is always refused,
 * with no claim backfill. Any violation throws CoursewareOrgAccessError (403).
 */
export function assertBindingOrgMatchesCourseware(
  courseware: Pick<Courseware, 'id' | 'orgId'>,
  bindingOrgId: string,
): void {
  const cwOrgId = normalizeOrgId(courseware.orgId);
  const orgId = normalizeOrgId(bindingOrgId);
  if (!orgId) {
    throw new CoursewareOrgAccessError('binding orgId is required');
  }
  if (!cwOrgId) {
    throw new CoursewareOrgAccessError(
      `courseware ${courseware.id} has no organization and cannot be bound; ` +
        `organization is assigned when the courseware is created`,
    );
  }
  if (cwOrgId !== orgId) {
    throw new CoursewareOrgAccessError(
      `courseware org mismatch: courseware ${courseware.id} belongs to org ${cwOrgId}; ` +
        `bindings must use the same org (got ${orgId})`,
    );
  }
}

/**
 * Org agent: the credential is bound to a single organization, so only the same org passes; human-only `/organization/list`
 * / `managed_list` are not queried (agents are usually not in those lists).
 */
function canOrgAgentAccessOrg(
  session: AinobiAuthorizedSession,
  orgId: string | null | undefined,
): boolean {
  if (!isOrgAgentSession(session)) {
    return false;
  }
  const targetOrgId = normalizeOrgId(orgId);
  const currentOrgId = normalizeOrgId(session.currentOrgId);
  return Boolean(targetOrgId) && Boolean(currentOrgId) && currentOrgId === targetOrgId;
}

/** Organization member (students included): the target org appears in `/organization/list`. Ignores current_org_id. */
export async function canAccessOrgAsMember(
  session: Pick<AinobiAuthorizedSession, 'accessToken'>,
  orgId: string | null | undefined,
): Promise<boolean> {
  const targetOrgId = normalizeOrgId(orgId);
  if (!targetOrgId) {
    return false;
  }
  const member = await resolveMemberOrgIds(session.accessToken);
  if (member.has(targetOrgId)) {
    return true;
  }
  // The cache may lag behind a role change (e.g. a just-created/just-granted organization): force invalidation and probe once more
  await invalidateCachedOrgIds(session.accessToken);
  const refreshed = await resolveMemberOrgIds(session.accessToken);
  return refreshed.has(targetOrgId);
}

/**
 * Organization management side (teacher+): the target org appears in `/organization/managed_list`.
 * For courseware writes / edit permission; ignores current_org_id and doesn't rely on manage_login in session.permissions.
 */
export async function canManageOrg(
  session: Pick<AinobiAuthorizedSession, 'accessToken'>,
  orgId: string | null | undefined,
): Promise<boolean> {
  const targetOrgId = normalizeOrgId(orgId);
  if (!targetOrgId) {
    return false;
  }
  const managed = await resolveManagedOrgIds(session.accessToken);
  if (managed.has(targetOrgId)) {
    return true;
  }
  // The cache may lag behind a role change (e.g. a just-created/just-granted organization): force invalidation and probe once more
  await invalidateCachedOrgIds(session.accessToken);
  const refreshed = await resolveManagedOrgIds(session.accessToken);
  return refreshed.has(targetOrgId);
}

/**
 * Courseware write / management permission: the human path requires the courseware's org to be in managed_list (ignores current_org_id).
 * Org agent: same org only (the credential is bound to a single organization), not through the human-only managed_list.
 * Single-org invariant: a courseware without an org (only possible for legacy rows) is always refused.
 */
export async function canAccessCoursewareOrg(
  session: AinobiAuthorizedSession,
  courseware: Pick<Courseware, 'orgId'>,
): Promise<boolean> {
  const targetOrgId = normalizeOrgId(courseware.orgId);
  if (!targetOrgId) {
    return false;
  }

  if (isOrgAgentSession(session)) {
    return canOrgAgentAccessOrg(session, targetOrgId);
  }

  return canManageOrg(session, courseware.orgId);
}

export async function assertCoursewareOrgAccess(
  session: AinobiAuthorizedSession,
  courseware: Pick<Courseware, 'orgId'>,
): Promise<void> {
  if (!(await canAccessCoursewareOrg(session, courseware))) {
    throw new CoursewareOrgAccessError();
  }
}

/**
 * Organization isolation of read / query endpoints: the human path requires the target org in `/organization/list`.
 * Org agent (MCP): same org only, without calling the member list.
 * Doesn't use the login session's current_org_id as the human access gate.
 * Includes section-binding/list: `course_section:query` is the capability gate, and human org isolation only checks membership.
 */
export async function assertOrgIdAccess(
  session: AinobiAuthorizedSession,
  orgId: string,
): Promise<void> {
  if (isOrgAgentSession(session)) {
    if (!canOrgAgentAccessOrg(session, orgId)) {
      throw new CoursewareOrgAccessError();
    }
    return;
  }
  if (!(await canAccessOrgAsMember(session, orgId))) {
    throw new CoursewareOrgAccessError();
  }
}

/**
 * Target org of a write: the human path must be in managed_list (teacher+); an org agent same org only.
 * Used for creating coursewares, rebinding etc. (consistent with {@link canAccessCoursewareOrg}).
 */
export async function assertOrgIdManageAccess(
  session: AinobiAuthorizedSession,
  orgId: string,
): Promise<void> {
  if (isOrgAgentSession(session)) {
    if (!canOrgAgentAccessOrg(session, orgId)) {
      throw new CoursewareOrgAccessError();
    }
    return;
  }
  if (!(await canManageOrg(session, orgId))) {
    throw new CoursewareOrgAccessError();
  }
}

export type CoursewareActorContext = {
  userId: string;
  accountName: string;
  orgId: string;
};

/**
 * Audit / actor context. `orgId` comes from check_session's current_org_id and is only for records;
 * never use it as an organization access gate (use assertOrgIdAccess / canManageOrg for access).
 */
export function actorFromSession(session: AinobiAuthorizedSession): CoursewareActorContext {
  return {
    userId: session.userId,
    accountName: session.user.account_name,
    orgId: session.currentOrgId,
  };
}
