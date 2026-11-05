// SPDX-License-Identifier: AGPL-3.0-only
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { sendJsonWithCors } from './http/cors.ts';
import { requestPathname } from './http/request.ts';

/**
 * This service is intranet-only and has exactly one legitimate caller:
 * ainobi-courseware-agent's `/courseware/render/tasks*` proxy (which performs its own
 * courseware-access checks before ever reaching here) and its own `/courseware/render/callback`
 * receiver (which this service calls back). There is no end-user-facing auth path — a single
 * shared secret is enough, and it keeps this service from having to depend on the platform's
 * session/permission model at all.
 */
function resolveVideoRenderInternalToken(): string | null {
  return process.env.AINOBI_VIDEO_RENDER_INTERNAL_TOKEN?.trim() || null;
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function extractInternalToken(req: IncomingMessage): string | null {
  const header = req.headers['x-ainobi-internal-token'];
  const value = Array.isArray(header) ? header[0] : header;
  return value?.trim() || null;
}

export function isAuthorizedByInternalToken(req: IncomingMessage): boolean {
  const expected = resolveVideoRenderInternalToken();
  if (!expected) {
    return false;
  }
  const provided = extractInternalToken(req);
  if (!provided) {
    return false;
  }
  return timingSafeStringEqual(provided, expected);
}

export async function authorizeRequest(req: IncomingMessage): Promise<boolean> {
  return isAuthorizedByInternalToken(req);
}

export function sendUnauthorized(res: ServerResponse): void {
  sendJsonWithCors(res, 401, { ok: false, error: 'Unauthorized' });
}

export function isPublicRoute(method: string | undefined, pathname: string): boolean {
  if (method === 'GET' && pathname === '/health') {
    return true;
  }
  return false;
}

export function isPublicRequest(method: string | undefined, url: string | undefined): boolean {
  if (method === 'OPTIONS') {
    return true;
  }

  return isPublicRoute(method, requestPathname(url));
}
