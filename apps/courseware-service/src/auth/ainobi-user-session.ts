// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';

import { ainobiBackendApiUrl } from '../config/ainobi-backend-api.ts';
import { redisClient } from '../db/db.ts';
import {
  agentHandoffTokenMinutes,
  exchangeAgentApiKeyForHandoffAccessToken,
  invalidateCachedAgentApiKeyExchange,
  invalidateCachedAgentHandoffToken,
  isAinobiAgentApiKey,
  resolveBearerToAccessToken,
} from './ainobi-agent-api-key.ts';
import { resolveManagedOrgIds } from './ainobi-org-access.ts';

export const MANAGE_LOGIN_PERMISSION = 'user:manage_login';
export const COURSE_SECTION_QUERY_PERMISSION = 'course_section:query';
export const USER_TYPE_AGENT = 'agent';

const SESSION_CACHE_KEY_PREFIX = 'ainobi-courseware-agent:session:';

export type AinobiSessionUser = {
  user_id: string;
  user_name: string;
  account_name: string;
  email: string | null;
  user_status: string;
  user_avatar_url: string | null;
  user_type: string;
};

export type AinobiSessionOrganization = {
  org_id: string;
  org_name: string;
  org_type: string;
  org_status: string;
  org_avatar_url: string | null;
  current_org_id?: string;
};

/** Session context verified by check_session (individual endpoints then assert permissions). */
export type AinobiAuthorizedSession = {
  roles: string[];
  user: AinobiSessionUser;
  organization: AinobiSessionOrganization | null;
  permissions: string[];
  userId: string;
  /** Owner for agent sessions; equals userId for humans. */
  permissionUserId: string;
  currentOrgId: string;
  accessToken: string;
  expireAt: string;
  /** True when education `user.user_type === 'agent'` (org automation key). */
  isOrgAgent: boolean;
  /**
   * Original bearer when it was an `ainobi_ak_*` credential (present only on
   * org-agent sessions). Lets the handoff flow mint a dedicated long-lived
   * token via `POST /agent/token` without re-asking the caller.
   */
  credential?: string;
};

type CheckSessionApiUser = {
  user_id?: string;
  user_name?: string;
  account_name?: string;
  email?: string | null;
  user_status?: string;
  user_avatar_url?: string | null;
  user_type?: string;
};

type CheckSessionApiOrganization = {
  org_id?: string;
  org_name?: string;
  org_type?: string;
  org_status?: string;
  org_avatar_url?: string | null;
};

type CheckSessionApiData = {
  roles?: string[];
  user?: CheckSessionApiUser;
  organization?: CheckSessionApiOrganization | null;
  permissions?: string[];
  user_id?: string;
  permission_user_id?: string;
  current_org_id?: string;
  access_token?: string;
  expire_at?: string;
};

type CheckSessionApiResponse = {
  code?: number;
  success?: boolean;
  message?: string;
  data?: CheckSessionApiData;
};

type CachedAuthorizedSession = Omit<AinobiAuthorizedSession, 'accessToken'>;

export function hasSessionPermission(
  permissions: readonly string[] | undefined,
  permission: string,
): boolean {
  return Boolean(permission && permissions?.includes(permission));
}

export function hasManageLoginPermission(permissions: readonly string[] | undefined): boolean {
  return hasSessionPermission(permissions, MANAGE_LOGIN_PERMISSION);
}

export function hasCourseSectionQueryPermission(permissions: readonly string[] | undefined): boolean {
  return hasSessionPermission(permissions, COURSE_SECTION_QUERY_PERMISSION);
}

/** Org Agent (automation) session — admitted for same-org courseware write without manage_login. */
export function isOrgAgentSession(
  session: Pick<AinobiAuthorizedSession, 'isOrgAgent'> | null | undefined,
): boolean {
  return Boolean(session?.isOrgAgent);
}

function sessionCacheKey(accessToken: string): string {
  const digest = createHash('sha256').update(accessToken, 'utf8').digest('hex');
  return `${SESSION_CACHE_KEY_PREFIX}${digest}`;
}

/**
 * Cache TTL cap: backend-side revocations (logout, org removal, role/permission changes,
 * user disable) must take effect within minutes, not when the token itself expires
 * (ACCESS_TOKEN_EXPIRE_MINUTES defaults to 7 days). The bound covers NEW HTTP requests;
 * an in-flight streaming turn runs to completion, and long-lived sockets (gemini-live)
 * authenticate once at upgrade and are not re-validated mid-connection.
 */
const DEFAULT_SESSION_CACHE_TTL_CAP_SECONDS = 300;

export function sessionCacheTtlCapSeconds(): number {
  const n = Math.floor(
    Number(process.env.AINOBI_SESSION_CACHE_TTL_CAP_SECONDS ?? DEFAULT_SESSION_CACHE_TTL_CAP_SECONDS),
  );
  // Validate the floored value: a fractional env like 0.5 must fall back, not degrade to a 0s cap
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SESSION_CACHE_TTL_CAP_SECONDS;
}

export function cacheTtlSeconds(expireAt: string): number | null {
  const expiresMs = Date.parse(expireAt);
  if (!Number.isFinite(expiresMs)) {
    return null;
  }

  const ttlMs = expiresMs - Date.now();
  if (ttlMs <= 0) {
    return null;
  }

  return Math.max(1, Math.min(Math.ceil(ttlMs / 1000), sessionCacheTtlCapSeconds()));
}

function mapUser(user: CheckSessionApiUser | undefined): AinobiSessionUser | null {
  const userId = user?.user_id?.trim();
  if (!user || !userId) {
    return null;
  }

  return {
    user_id: userId,
    user_name: user.user_name?.trim() || userId,
    account_name: user.account_name?.trim() || userId,
    email: user.email ?? null,
    user_status: user.user_status?.trim() || 'unknown',
    user_avatar_url: user.user_avatar_url ?? null,
    user_type: user.user_type?.trim().toLowerCase() || 'normal',
  };
}

function mapOrganization(
  organization: CheckSessionApiOrganization | null | undefined,
  currentOrgId: string,
): AinobiSessionOrganization | null {
  const orgId = organization?.org_id?.trim() || currentOrgId.trim();
  if (!orgId) {
    return null;
  }

  return {
    org_id: orgId,
    org_name: organization?.org_name?.trim() || orgId,
    org_type: organization?.org_type?.trim() || 'unknown',
    org_status: organization?.org_status?.trim() || 'unknown',
    org_avatar_url: organization?.org_avatar_url ?? null,
    current_org_id: currentOrgId || orgId,
  };
}

function mapValidatedSession(
  accessToken: string,
  data: CheckSessionApiData,
): AinobiAuthorizedSession | null {
  const user = mapUser(data.user);
  const userId = data.user_id?.trim() || user?.user_id;
  const currentOrgId = data.current_org_id?.trim() || data.organization?.org_id?.trim();
  const expireAt = data.expire_at?.trim();

  if (!user || !userId || !currentOrgId || !expireAt) {
    return null;
  }

  const permissionUserId = data.permission_user_id?.trim() || userId;
  const isOrgAgent = user.user_type === USER_TYPE_AGENT;

  return {
    roles: Array.isArray(data.roles) ? data.roles.filter((role) => typeof role === 'string') : [],
    user,
    organization: mapOrganization(data.organization, currentOrgId),
    permissions: Array.isArray(data.permissions)
      ? data.permissions.filter((permission) => typeof permission === 'string')
      : [],
    userId,
    permissionUserId,
    currentOrgId,
    accessToken: data.access_token?.trim() || accessToken,
    expireAt,
    isOrgAgent,
  };
}

async function readCachedSession(accessToken: string): Promise<AinobiAuthorizedSession | null> {
  try {
    const raw = await redisClient.get(sessionCacheKey(accessToken));
    if (!raw) {
      return null;
    }

    const cached = JSON.parse(raw) as CachedAuthorizedSession;
    if (!cached?.userId || !cached.expireAt) {
      return null;
    }

    if (Date.parse(cached.expireAt) <= Date.now()) {
      return null;
    }

    return { ...cached, accessToken };
  } catch (error) {
    console.warn(
      '[auth] Redis session cache read failed; falling back to check_session:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

async function writeCachedSession(session: AinobiAuthorizedSession): Promise<void> {
  const ttlSeconds = cacheTtlSeconds(session.expireAt);
  if (!ttlSeconds) {
    return;
  }

  const payload: CachedAuthorizedSession = {
    roles: session.roles,
    user: session.user,
    organization: session.organization,
    permissions: session.permissions,
    userId: session.userId,
    permissionUserId: session.permissionUserId,
    currentOrgId: session.currentOrgId,
    expireAt: session.expireAt,
    isOrgAgent: session.isOrgAgent,
  };

  try {
    await redisClient.set(sessionCacheKey(session.accessToken), JSON.stringify(payload), 'EX', ttlSeconds);
  } catch (error) {
    console.warn(
      '[auth] Redis session cache write failed:',
      error instanceof Error ? error.message : error,
    );
  }
}

async function fetchValidatedSession(accessToken: string): Promise<AinobiAuthorizedSession | null> {
  const url = ainobiBackendApiUrl('/user/check_session');

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: '{}',
    });
  } catch (error) {
    console.warn(
      '[auth] check_session request failed:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }

  let body: CheckSessionApiResponse;
  try {
    body = (await response.json()) as CheckSessionApiResponse;
  } catch {
    return null;
  }

  if (!response.ok || body.code !== 0 || body.success !== true || !body.data) {
    return null;
  }

  return mapValidatedSession(accessToken, body.data);
}

function hydrateCachedSession(
  cached: AinobiAuthorizedSession,
): AinobiAuthorizedSession {
  // Backfill fields for sessions cached before agent fields existed.
  const userType = cached.user?.user_type?.trim().toLowerCase() || 'normal';
  const isOrgAgent = Boolean(cached.isOrgAgent || userType === USER_TYPE_AGENT);
  return {
    ...cached,
    permissionUserId: cached.permissionUserId || cached.userId,
    isOrgAgent,
    user: {
      ...cached.user,
      user_type: userType,
    },
  };
}

/**
 * Verify the Bearer: a teacher access_token, or an organization agent's long-lived `ainobi_ak_*` (redeemed internally for a short-lived token).
 * The cache TTL is the token's remaining lifetime capped at AINOBI_SESSION_CACHE_TTL_CAP_SECONDS
 * (default 300s) — revocations on the backend (logout / org removal / permission changes) take
 * effect within that window instead of being bypassed until the 7-day token expiry.
 *
 * The org agent api_key path **skips** the per-access_token session cache: revoking a credential on the backend runs
 * `revoke_all_user_sessions`, but if courseware hit an old session cache it would bypass
 * check_session and stay usable for up to about an hour. Every request carrying `ainobi_ak_*` calls
 * check_session again; on failure the ak → token redemption cache is cleared, so a revoked short token isn't retried over and over.
 */
export async function resolveValidatedUserSession(
  bearerOrAccessToken: string,
): Promise<AinobiAuthorizedSession | null> {
  const bearer = bearerOrAccessToken.trim();
  const usedAgentApiKey = isAinobiAgentApiKey(bearer);
  const shortToken = await resolveBearerToAccessToken(bearer);
  if (!shortToken) {
    return null;
  }

  // Teacher short-lived tokens keep Redis session cache; agent api_keys do not.
  if (!usedAgentApiKey) {
    const cached = await readCachedSession(shortToken);
    if (cached) {
      return hydrateCachedSession(cached);
    }
  }

  const session = await fetchValidatedSession(shortToken);
  if (!session) {
    if (usedAgentApiKey) {
      // check_session failing means the sessions derived from these credentials can't be trusted (revoked/expired), so the short and
      // long (handoff) ticket caches must be invalidated together — otherwise ui_links keeps delivering an invalid
      // long ticket, and the handoff redemption can't build a browser session until the cache expires naturally (up to 7 days).
      await invalidateCachedAgentApiKeyExchange(bearer);
      await invalidateCachedAgentHandoffToken(bearer);
    }
    return null;
  }

  await writeCachedSession(session);
  // Keep the raw ainobi_ak_* on the session so the handoff flow can mint a
  // dedicated human-cycle token without the caller re-presenting it.
  return usedAgentApiKey ? { ...session, credential: bearer } : session;
}

/**
 * Verify the access token: it must hold user:manage_login (teacher/admin courseware endpoints),
 * or the user must have a manageable organization in `/organization/managed_list`.
 *
 * "Only an /organization/list member" or an org agent key is not attached to the global authorizeRequest:
 * that would open /chat and other agent/billing routes. Member read-only catalogs use
 * resolveRequestSession + assertOrgIdAccess in the handler; MCP uses {@link resolveAinobiUserSessionForMcp}.
 */
export async function resolveAinobiUserSession(
  bearerOrAccessToken: string,
): Promise<AinobiAuthorizedSession | null> {
  const session = await resolveValidatedUserSession(bearerOrAccessToken);
  if (!session) {
    return null;
  }
  if (hasManageLoginPermission(session.permissions)) {
    return session;
  }
  // current_org may be a student organization, in which case check_session.permissions lacks manage_login;
  // yet the user may still have management rights in other organizations. A non-empty managed_list lets it into the courseware auth flow.
  // Agents must not call the human-only managed_list; this is the human path only.
  const managedOrgIds = await resolveManagedOrgIds(session.accessToken);
  if (managedOrgIds.size === 0) {
    return null;
  }
  return session;
}

/**
 * Auth dedicated to MCP `/mcp`: the teacher path (manage_login / managed_list) or a same-org agent key.
 * Kept apart from {@link resolveAinobiUserSession} so agents never enter the global authorizeRequest.
 */
export async function resolveAinobiUserSessionForMcp(
  bearerOrAccessToken: string,
): Promise<AinobiAuthorizedSession | null> {
  const session = await resolveValidatedUserSession(bearerOrAccessToken);
  if (!session) {
    return null;
  }
  if (hasManageLoginPermission(session.permissions)) {
    return session;
  }
  if (isOrgAgentSession(session) && session.currentOrgId.trim()) {
    return session;
  }
  const managedOrgIds = await resolveManagedOrgIds(session.accessToken);
  if (managedOrgIds.size === 0) {
    return null;
  }
  return session;
}

/**
 * Token to embed into handoff codes (`courseware_ui_links`).
 *
 * Org-agent sessions mint a dedicated LONG-lived token (education clamps the
 * TTL to the human ``ACCESS_TOKEN_EXPIRE_MINUTES``) so browser sessions opened
 * via `?handoff=` live as long as a human login — the MCP's own working token
 * stays on its 60-minute bound. Cached per credential; any failure falls back
 * to the working token (previous behavior, 60-minute handoff sessions).
 */
export async function resolveHandoffAccessToken(
  session: AinobiAuthorizedSession,
): Promise<string> {
  if (!session.isOrgAgent || !session.credential) {
    return session.accessToken;
  }
  try {
    const longToken = await exchangeAgentApiKeyForHandoffAccessToken(
      session.credential,
      agentHandoffTokenMinutes(),
    );
    if (longToken) {
      return longToken;
    }
  } catch (error) {
    console.warn(
      '[auth] handoff token mint failed; using working token:',
      error instanceof Error ? error.message : error,
    );
  }
  return session.accessToken;
}

/** Verify the access token: it must hold the given permission (e.g. course_section:query). */
export async function resolveAinobiUserSessionWithPermission(
  bearerOrAccessToken: string,
  permission: string,
): Promise<AinobiAuthorizedSession | null> {
  const session = await resolveValidatedUserSession(bearerOrAccessToken);
  if (!session || !hasSessionPermission(session.permissions, permission)) {
    return null;
  }
  return session;
}
