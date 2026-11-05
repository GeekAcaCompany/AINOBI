// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from 'node:http';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import {
  attachAuthorizedSession,
  extractAuthorizationToken,
  getAuthorizedSession,
  sendUnauthorized,
} from '../api-auth.ts';
import { resolveAinobiUserSessionForMcp } from '../auth/ainobi-user-session.ts';
import { sendJsonWithCors } from '../http/cors.ts';
import { readJsonBody } from '../http/request.ts';
import { createCodexMcpServer } from './codex-mcp-server.ts';

/** ~28MiB raw JSON — enough for 20MB base64 image payloads with MCP JSON envelope. */
const CODEX_MCP_MAX_BODY_BYTES = 28 * 1024 * 1024;
/**
 * MCP Streamable HTTP endpoint for Codex / ChatGPT Apps (developer mode).
 *
 * Auth: `Authorization: Bearer <AINOBI access_token | org Agent ainobi_ak_*>`.
 * Org Agent keys are exchanged server-side via education `POST /agent/token`.
 * Mount: POST/GET/DELETE `/mcp` (and `/mcp/`).
 */
export async function handleCodexMcp(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const method = req.method ?? 'GET';

  let session = getAuthorizedSession(req);
  if (!session) {
    const token = extractAuthorizationToken(req.headers.authorization);
    if (token) {
      // Org Agent keys are admitted only here (not via global authorizeRequest).
      session = (await resolveAinobiUserSessionForMcp(token)) ?? undefined;
      if (session) {
        attachAuthorizedSession(req, session);
      }
    }
  }
  if (!session) {
    sendUnauthorized(res);
    return;
  }

  const server = createCodexMcpServer(session);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);

    let parsedBody: unknown;
    if (method === 'POST') {
      try {
        parsedBody = await readJsonBody(req, { maxBytes: CODEX_MCP_MAX_BODY_BYTES });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const tooLarge = /exceeds \d+ bytes/i.test(message);
        sendJsonWithCors(res, tooLarge ? 413 : 400, {
          ok: false,
          error: message,
        });
        return;
      }
    }

    await transport.handleRequest(req, res, parsedBody);
  } catch (error) {
    if (!res.headersSent) {
      sendJsonWithCors(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

/** True when pathname is the Codex MCP mount. */
export function isCodexMcpPath(pathname: string): boolean {
  return pathname === '/mcp' || pathname === '/mcp/';
}
