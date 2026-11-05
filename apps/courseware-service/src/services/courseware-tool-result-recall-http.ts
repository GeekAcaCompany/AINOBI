// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from "node:http";

import { getAuthorizedSession } from "../api-auth.ts";
import { dataSource } from "../db/db.ts";
import { ensureDataSource } from "../db/ensure-data-source.ts";
import { sendJsonWithCors } from "../http/cors.ts";
import { readJsonBody, sendJson } from "../http/request.ts";
import { recallToolResultBlob } from "./agent-tool-result-archive.ts";

type RecallBody = {
  id?: string;
  conversation_id?: string;
  session_id?: string;
  pretty?: boolean;
};

/**
 * POST `/courseware/tool-result/recall` — agent sandbox fetches archived tool output by id.
 * Requires an authorized session (same pattern as narration/search host callbacks).
 * Caller must scope the lookup with conversation_id and/or session_id.
 */
export async function handleCoursewareToolResultRecall(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!getAuthorizedSession(req)) {
    sendJsonWithCors(res, 401, { ok: false, error: "Unauthorized" });
    return;
  }

  let body: RecallBody;
  try {
    body = await readJsonBody<RecallBody>(req);
  } catch {
    sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
    return;
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    sendJson(res, 400, { ok: false, error: "id is required" });
    return;
  }

  const conversationId =
    typeof body.conversation_id === "string" ? body.conversation_id.trim() : "";
  const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
  // Blobs are always keyed by session; require it so UUID alone is not enough.
  if (!sessionId) {
    sendJson(res, 400, {
      ok: false,
      error: "session_id is required",
    });
    return;
  }

  // ensureDataSource() initializes the shared singleton and resolves to void.
  await ensureDataSource();
  const recalled = await recallToolResultBlob({
    dataSource,
    id,
    conversationId: conversationId || null,
    sessionId,
  });

  if (!recalled) {
    sendJson(res, 404, {
      ok: false,
      exit_code: 1,
      stdout: "",
      stderr: `Tool result blob not found: ${id}`,
      error: `Tool result blob not found: ${id}`,
    });
    return;
  }

  const envelope = {
    ok: true,
    data: {
      id: recalled.id,
      tool_name: recalled.toolName,
      command_summary: recalled.commandSummary,
      truncated: recalled.truncated,
      byte_size: recalled.byteSize,
      content: recalled.content,
    },
  };
  const pretty = body.pretty !== false;
  const stdout = pretty ? `${JSON.stringify(envelope, null, 2)}\n` : `${JSON.stringify(envelope)}\n`;

  sendJson(res, 200, {
    ok: true,
    exit_code: 0,
    stdout,
    stderr: "",
  });
}
