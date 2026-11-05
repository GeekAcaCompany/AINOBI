// SPDX-License-Identifier: AGPL-3.0-only
import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import { CoursewareOrgAccessError, normalizeOrgId } from '../auth/ainobi-org-access.ts';
import { ensureDataSource } from '../db/ensure-data-source.ts';
import { assertCoursewareRequestAccess } from '../services/courseware-org-guard.ts';
import { getCoursewareEntityById } from '../services/courseware-service.ts';
import {
  getCodexMcpSession,
  isCodexMcpWorkspaceReady,
  type CodexMcpWorkspaceSession,
} from './codex-mcp-session.ts';

export type CodexMcpToolError = {
  ok: false;
  error: string;
  code?: string;
};

export function toolError(message: string, code?: string): CodexMcpToolError {
  return { ok: false, error: message, ...(code ? { code } : {}) };
}

export function isToolError(value: unknown): value is CodexMcpToolError {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as CodexMcpToolError).ok === false &&
      typeof (value as CodexMcpToolError).error === 'string',
  );
}

/**
 * When an MCP workspace is open, catalog fetches must use that courseware's org —
 * an explicit org_id override would otherwise persist foreign teachers/voices into the session.
 */
export function resolveCatalogOrgIdForMcpSession(args: {
  mcpSession?: CodexMcpWorkspaceSession;
  requestedOrgId?: string;
  callerOrgId?: string | null;
}): { ok: true; orgIdRaw: string } | { ok: false; error: CodexMcpToolError } {
  const sessionOrg = args.mcpSession?.coursewareOrgId?.trim() || undefined;
  const explicit = args.requestedOrgId?.trim() || undefined;
  if (args.mcpSession && sessionOrg && explicit) {
    const a = normalizeOrgId(explicit);
    const b = normalizeOrgId(sessionOrg);
    if (a && b && a !== b) {
      return {
        ok: false,
        error: toolError(
          'org_id does not match the open courseware organization; omit org_id or open the matching courseware',
          'ORG_MISMATCH',
        ),
      };
    }
  }
  const orgIdRaw = sessionOrg || explicit || args.callerOrgId?.trim() || '';
  if (!orgIdRaw) {
    return {
      ok: false,
      error: toolError(
        'org_id is required (open a courseware first or pass org_id / use an org-bound Agent key)',
        'ORG_REQUIRED',
      ),
    };
  }
  return { ok: true, orgIdRaw };
}

export async function requireOwnedSession(
  caller: AinobiAuthorizedSession,
  mcpSessionId: string | undefined,
): Promise<CodexMcpWorkspaceSession | CodexMcpToolError> {
  const id = mcpSessionId?.trim();
  if (!id) {
    return toolError('mcp_session_id is required', 'SESSION_REQUIRED');
  }
  const session = await getCodexMcpSession(id);
  if (!session) {
    return toolError(`Unknown mcp_session_id: ${id}`, 'SESSION_NOT_FOUND');
  }
  if (session.ownerUserId !== caller.userId) {
    return toolError('Forbidden: mcp_session_id belongs to another user', 'FORBIDDEN');
  }
  return session;
}

/**
 * On FC multi-instance, Redis may have the binding while this container lacks the workspace.
 * Always re-check write access — even when workspace files already exist — so revoked
 * rights / deleted courseware cannot keep using a live mcp_session_id.
 *
 * Do **not** silently reload from DB when the local workspace is missing: another instance
 * may hold dirty unsaved edits. Fail closed and require sticky routing or courseware_open.
 */
export async function ensureHydratedWorkspace(
  caller: AinobiAuthorizedSession,
  session: CodexMcpWorkspaceSession,
): Promise<CodexMcpToolError | null> {
  await ensureDataSource();
  const cw = await getCoursewareEntityById(session.coursewareId);
  if (!cw) {
    return toolError(`Courseware missing for hydrate: ${session.coursewareId}`, 'NOT_FOUND');
  }
  try {
    await assertCoursewareRequestAccess(caller, cw, 'write');
  } catch (error) {
    if (error instanceof CoursewareOrgAccessError) {
      return toolError('Forbidden: no write access to this courseware', 'FORBIDDEN');
    }
    throw error;
  }

  if (await isCodexMcpWorkspaceReady(session)) {
    return null;
  }

  return toolError(
    'MCP workspace is not available on this instance (unsaved edits may exist elsewhere). Retry for sticky routing, or call courseware_open again.',
    'WORKSPACE_NOT_LOCAL',
  );
}
