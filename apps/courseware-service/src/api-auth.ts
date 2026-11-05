// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AinobiAuthorizedSession } from './auth/ainobi-user-session.ts';
import {
  hasSessionPermission,
  resolveAinobiUserSession,
  resolveAinobiUserSessionWithPermission,
  resolveValidatedUserSession,
} from './auth/ainobi-user-session.ts';
import { sendJsonWithCors } from './http/cors.ts';
import { requestPathname } from './http/request.ts';

const requestSessions = new WeakMap<IncomingMessage, AinobiAuthorizedSession>();

export function extractAuthorizationToken(header: string | undefined): string | null {
  if (!header?.trim()) {
    return null;
  }

  const trimmed = header.trim();
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(trimmed);
  const token = (bearerMatch?.[1] ?? trimmed).trim();
  return token || null;
}

export function getAuthorizedSession(req: IncomingMessage): AinobiAuthorizedSession | undefined {
  return requestSessions.get(req);
}

export function attachAuthorizedSession(
  req: IncomingMessage,
  session: AinobiAuthorizedSession,
): void {
  requestSessions.set(req, session);
}

export async function authorizeRequest(req: IncomingMessage): Promise<boolean> {
  const token = extractAuthorizationToken(req.headers.authorization);
  if (!token) {
    return false;
  }

  const session = await resolveAinobiUserSession(token);
  if (!session) {
    return false;
  }

  attachAuthorizedSession(req, session);
  return true;
}

/**
 * Resolve any valid login session (not limited to `user:manage_login`); on success it is attached to the current request.
 * Student endpoints (e.g. quiz answer recording upload) may have no session attached at the route layer and must call this in the handler.
 */
export async function resolveRequestSession(
  req: IncomingMessage,
): Promise<AinobiAuthorizedSession | null> {
  const existing = getAuthorizedSession(req);
  if (existing?.userId?.trim()) {
    return existing;
  }

  const token = extractAuthorizationToken(req.headers.authorization);
  if (!token) {
    return null;
  }

  const session = await resolveValidatedUserSession(token);
  if (!session?.userId?.trim()) {
    return null;
  }

  attachAuthorizedSession(req, session);
  return session;
}

/** Require any valid login session (student or teacher). */
export async function requireRequestSession(
  req: IncomingMessage,
): Promise<AinobiAuthorizedSession> {
  const session = await resolveRequestSession(req);
  if (!session) {
    throw new Error('Unauthorized');
  }
  return session;
}

/** Resolve a session holding the given permission; on success it is attached to the current request, otherwise returns null. */
export async function resolveRequestSessionWithPermission(
  req: IncomingMessage,
  permission: string,
): Promise<AinobiAuthorizedSession | null> {
  const existing = getAuthorizedSession(req);
  if (existing && hasSessionPermission(existing.permissions, permission)) {
    return existing;
  }

  const token = extractAuthorizationToken(req.headers.authorization);
  if (!token) {
    return null;
  }

  const session = await resolveAinobiUserSessionWithPermission(token, permission);
  if (!session) {
    return null;
  }

  attachAuthorizedSession(req, session);
  return session;
}

/** Require login with the given permission; without a session, resolves it from the token and attaches it to the current request. */
export async function requireSessionWithPermission(
  req: IncomingMessage,
  permission: string,
): Promise<AinobiAuthorizedSession> {
  const session = await resolveRequestSessionWithPermission(req, permission);
  if (!session) {
    throw new Error('Unauthorized');
  }
  return session;
}

export function sendUnauthorized(res: ServerResponse): void {
  sendJsonWithCors(res, 401, { ok: false, error: 'Unauthorized' });
}

/** Paths that need no auth (OPTIONS excluded, handled separately by the route layer). */
export function isPublicRoute(method: string | undefined, pathname: string): boolean {
  if (method === 'GET' && pathname === '/health') {
    return true;
  }
  if (method === 'GET' && pathname === '/plugins/ainobi-courseware-codex-plugin.zip') {
    return true;
  }
  if (
    method === 'GET' &&
    (pathname === '/.well-known/oauth-protected-resource' ||
      pathname === '/.well-known/oauth-protected-resource/mcp')
  ) {
    return true;
  }
  // Handoff redeem: the code itself is the bearer credential (high entropy,
  // short TTL, bounded redemptions) — see services/agent-handoff.ts.
  if (method === 'POST' && pathname === '/agent-handoff/redeem') {
    return true;
  }
  // Agent connect codes (console connect instructions): code = credential, one-time, 15min
  // TTL — see services/agent-connect.ts.
  if (method === 'GET' && /^\/agent\/connect\/[A-Za-z0-9-]+$/.test(pathname)) {
    return true;
  }
  if (
    method === 'POST' &&
    /^\/agent\/connect\/[A-Za-z0-9-]+\/credential$/.test(pathname)
  ) {
    return true;
  }
  return false;
}

/**
 * Courseware paths may skip Bearer auth first; the handler checks the courseware's `is_share` / `is_public`.
 * Organization lists, live streams etc. still require login (see {@link isLoginRequiredCoursewareRoute}).
 */
export function isAnonymousCoursewareRoute(pathname: string): boolean {
  if (isLoginRequiredCoursewareRoute(pathname)) {
    return false;
  }
  return pathname === '/courseware' || pathname.startsWith('/courseware/');
}

/**
 * Courseware routes that must pass the global login gate first.
 * `/courseware/list` allows "any valid login" (including plain members), checked by the handler with
 * requireRequestSession + assertOrgIdAccess, so it is not listed here (otherwise the manage-only
 * authorizeRequest would block plain students).
 */
export function isLoginRequiredCoursewareRoute(pathname: string): boolean {
  return (
    pathname === '/courseware/stream' ||
    pathname === '/courseware/stream/publish' ||
    pathname === '/courseware/sharing'
  );
}

/**
 * Routes still reachable after the global authorizeRequest (manage-only) fails, where the handler attaches
 * "any valid session" itself and checks member scope.
 */
export function isMemberSessionCoursewareRoute(pathname: string): boolean {
  return pathname === '/courseware/list';
}

/** Health checks and static debug pages, no auth needed. */
export function isPublicRequest(method: string | undefined, url: string | undefined): boolean {
  if (method === 'OPTIONS') {
    return true;
  }

  return isPublicRoute(method, requestPathname(url));
}
