// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  getAuthorizedSession,
  sendUnauthorized,
} from "../api-auth.ts";
import { CoursewareOrgAccessError, normalizeOrgId } from "../auth/ainobi-org-access.ts";
import { sendJson } from "../http/request.ts";
import { sendJsonWithCors } from "../http/cors.ts";
import type { AinobiAuthorizedSession } from "../auth/ainobi-user-session.ts";
import { assertOrgIdManageAccess } from "./courseware-design-templates-service.ts";
import {
  AgentConnectError,
  buildAgentConnectInstruction,
  buildMarkdownGuide,
  getAgentConnectRecord,
  issueAgentConnectCode,
  redeemAgentConnectCredential,
  resolveAgentConnectCode,
} from "./agent-connect.ts";

/**
 * Console Agent-panel endpoints.
 *
 * - `GET  /agent/connect-code`              — session (manager+): current/minted code + instruction
 * - `GET  /agent/connect/{code}`            — public: markdown onboarding guide (no secrets)
 * - `POST /agent/connect/{code}/credential` — public: one-time env file delivery
 * - `GET  /agent/connect-record/{agentUserId}` — session (manager+): 7-day doc replay (connect record)
 *
 * The code itself is the bearer credential on the two public routes; see
 * agent-connect.ts for the model. Errors on public routes use 410/409 without
 * distinguishing unknown vs expired.
 */

/** `GET /agent/connect/{code}` — returns the code, else null. */
export function parseAgentConnectCodePath(pathname: string): string | null {
  const match = /^\/agent\/connect\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1] ?? "") : null;
}

/** `POST /agent/connect/{code}/credential` — returns the code, else null. */
export function parseAgentConnectCredentialPath(pathname: string): string | null {
  const match = /^\/agent\/connect\/([^/]+)\/credential$/.exec(pathname);
  return match ? decodeURIComponent(match[1] ?? "") : null;
}

/** `GET /agent/connect-record/{agentUserId}` — returns the agent user id, else null. */
export function parseAgentConnectRecordPath(pathname: string): string | null {
  const match = /^\/agent\/connect-record\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1] ?? "") : null;
}

function handleConnectError(res: ServerResponse, error: unknown): void {
  if (error instanceof AgentConnectError) {
    sendJsonWithCors(res, error.status, { ok: false, error: error.message, code: error.code });
    return;
  }
  console.error(
    "[agent-connect] unexpected failure:",
    error instanceof Error ? error.message : error,
  );
  sendJsonWithCors(res, 500, { ok: false, error: "Agent connect failed" });
}

/** `GET /agent/connect-code` — console fetches (or reuses) the org's live code. */
export async function handleAgentConnectCodeGet(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const session: AinobiAuthorizedSession | undefined = getAuthorizedSession(req);
  if (!session) {
    sendUnauthorized(res);
    return;
  }

  const url = new URL(req.url ?? "/", "http://internal");
  const orgIdRaw = url.searchParams.get("org_id")?.trim() || session.currentOrgId?.trim() || "";
  const orgName = url.searchParams.get("org_name")?.trim() || null;
  const orgId = normalizeOrgId(orgIdRaw);
  if (!orgId) {
    sendJson(res, 400, { ok: false, error: "org_id is required", code: "ORG_REQUIRED" });
    return;
  }

  try {
    await assertOrgIdManageAccess(session, orgId);
  } catch (error) {
    if (error instanceof CoursewareOrgAccessError) {
      sendJson(res, 403, {
        ok: false,
        error: "Forbidden: agent connect requires manager access to this org",
        code: "FORBIDDEN",
      });
      return;
    }
    throw error;
  }

  try {
    const issued = await issueAgentConnectCode({
      accessToken: session.accessToken,
      ownerUserId: session.userId,
      orgId,
      orgName,
    });
    sendJson(res, 200, {
      ok: true,
      data: {
        code: issued.code,
        connect_url: issued.connectUrl,
        expires_at: issued.expiresAt,
        ttl_seconds: issued.ttlSeconds,
        agent_name: issued.agentName,
        instruction: buildAgentConnectInstruction({
          connectUrl: issued.connectUrl,
          orgName,
        }),
      },
    });
  } catch (error) {
    handleConnectError(res, error);
  }
}

/** `GET /agent/connect/{code}` — public markdown onboarding guide (no secrets). */
export async function handleAgentConnectDocGet(
  req: IncomingMessage,
  res: ServerResponse,
  code: string,
): Promise<void> {
  try {
    const resolved = await resolveAgentConnectCode(code);
    const markdown = buildMarkdownGuide({
      code: resolved.code,
      orgId: resolved.payload.org_id,
      orgName: resolved.payload.org_name,
      mcpUrl: resolved.payload.mcp_url,
      credentialExpiresAt: resolved.payload.credential_expires_at,
    });
    res.writeHead(200, {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(markdown);
  } catch (error) {
    handleConnectError(res, error);
  }
}

/** `POST /agent/connect/{code}/credential` — public one-time env delivery. */
export async function handleAgentConnectCredentialPost(
  req: IncomingMessage,
  res: ServerResponse,
  code: string,
): Promise<void> {
  const client = String(req.headers["x-ainobi-client"] ?? "").trim() || null;
  try {
    const envFile = await redeemAgentConnectCredential(code, client);
    res.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(envFile);
  } catch (error) {
    handleConnectError(res, error);
  }
}

/** `GET /agent/connect-record/{agentUserId}` — session (manager+), 7-day doc replay. */
export async function handleAgentConnectRecordGet(
  req: IncomingMessage,
  res: ServerResponse,
  agentUserId: string,
): Promise<void> {
  const session: AinobiAuthorizedSession | undefined = getAuthorizedSession(req);
  if (!session) {
    sendUnauthorized(res);
    return;
  }
  // The org gate is a hard prerequisite: no org to go by = 400; agent not in that org = 404 (existence not leaked)
  const url = new URL(req.url ?? "/", "http://internal");
  const orgIdRaw = url.searchParams.get("org_id")?.trim() || session.currentOrgId?.trim() || "";
  const orgId = normalizeOrgId(orgIdRaw);
  if (!orgId) {
    sendJson(res, 400, { ok: false, error: "org_id is required", code: "ORG_REQUIRED" });
    return;
  }
  try {
    await assertOrgIdManageAccess(session, orgId);
  } catch (error) {
    if (error instanceof CoursewareOrgAccessError) {
      sendJson(res, 403, { ok: false, error: "Forbidden", code: "FORBIDDEN" });
      return;
    }
    throw error;
  }
  try {
    const markdown = await getAgentConnectRecord(agentUserId, orgId);
    sendJson(res, 200, { ok: true, data: { markdown } });
  } catch (error) {
    handleConnectError(res, error);
  }
}
