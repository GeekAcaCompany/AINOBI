// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from "node:http";

import { readJsonBody, sendJson } from "../http/request.ts";
import {
  isSafeAgentHandoffCode,
  redeemAgentHandoff,
  type AgentHandoffPayload,
} from "./agent-handoff.ts";

/** Body is just `{ code }` — nothing else is needed or allowed. */
const MAX_REDEEM_BODY_BYTES = 4 * 1024;

/**
 * `POST /agent-handoff/redeem` — exchange a one-time-ish handoff code for the
 * agent access token it was minted with. Public by design (the code is the
 * bearer credential): high entropy, short TTL, bounded redemptions, stored
 * hashed. See `agent-handoff.ts` for the threat model.
 *
 * Callers are the web frontends' boot code (student AuthContext, manage
 * session-manager) which detect `?handoff=` in the URL; the access_token is
 * exchanged for a full validated session via the education backend
 * `check_session` and never written back into any URL.
 */
export async function handleAgentHandoffRedeem(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  let body: { code?: unknown };
  try {
    body = await readJsonBody<{ code?: unknown }>(req, { maxBytes: MAX_REDEEM_BODY_BYTES });
  } catch (error) {
    sendJson(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid request body",
    });
    return;
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!isSafeAgentHandoffCode(code)) {
    sendJson(res, 400, { ok: false, error: "code is required", code: "HANDOFF_CODE_REQUIRED" });
    return;
  }

  let payload: AgentHandoffPayload | null;
  try {
    payload = await redeemAgentHandoff(code);
  } catch (error) {
    console.error(
      "[agent-handoff] redeem failed:",
      error instanceof Error ? error.message : error,
    );
    sendJson(res, 500, { ok: false, error: "Handoff redeem failed" });
    return;
  }

  if (!payload) {
    // Invalid / expired / exhausted are indistinguishable on purpose.
    sendJson(res, 410, {
      ok: false,
      error: "Handoff code is invalid, expired, or already fully consumed",
      code: "HANDOFF_INVALID",
    });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    data: {
      access_token: payload.access_token,
      owner_user_id: payload.owner_user_id,
      courseware_id: payload.courseware_id,
      org_id: payload.org_id,
      minted_at: payload.minted_at,
    },
  });
}

/** True when pathname is the handoff redeem endpoint. */
export function isAgentHandoffRedeemPath(pathname: string): boolean {
  return pathname === "/agent-handoff/redeem";
}
