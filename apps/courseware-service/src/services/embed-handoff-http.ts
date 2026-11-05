// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from "node:http";

import { getAuthorizedSession, sendUnauthorized } from "../api-auth.ts";
import type { AinobiAuthorizedSession } from "../auth/ainobi-user-session.ts";
import { readJsonBody, sendJson } from "../http/request.ts";
import { mintAgentHandoff } from "./agent-handoff.ts";

const MAX_BODY_BYTES = 4 * 1024;
/** Long enough for the frame to boot and ask; short enough to be useless if leaked. */
const EMBED_HANDOFF_TTL_SECONDS = 60;

/**
 * `POST /embed/handoff` — a signed-in host page (the console embedding the editor or the
 * player) mints a one-time code that hands its own session to an embedded AINOBI page over
 * the embed protocol. The code carries the caller's own access token, so the frame gains
 * nothing the caller does not already hold; it is single-use, lives 60 s, and is stored
 * hashed (agent-handoff.ts). Body: `{ courseware_id?, org_id? }` for audit context.
 */
export async function handleEmbedHandoffMint(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const session: AinobiAuthorizedSession | undefined = getAuthorizedSession(req);
  if (!session) {
    sendUnauthorized(res);
    return;
  }

  let body: { courseware_id?: unknown; org_id?: unknown } = {};
  try {
    body = await readJsonBody<typeof body>(req, { maxBytes: MAX_BODY_BYTES });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid request body" });
    return;
  }
  const coursewareId = typeof body.courseware_id === "string" ? body.courseware_id.trim() : "";
  const orgId = typeof body.org_id === "string" && body.org_id.trim() ? body.org_id.trim() : null;

  try {
    const minted = await mintAgentHandoff(
      { accessToken: session.accessToken, ownerUserId: session.userId, coursewareId, orgId },
      { ttlSeconds: EMBED_HANDOFF_TTL_SECONDS, maxRedemptions: 1 },
    );
    sendJson(res, 200, { ok: true, data: { code: minted.code, expires_at: minted.expiresAt } });
  } catch (error) {
    console.error("[embed-handoff] mint failed:", error instanceof Error ? error.message : error);
    sendJson(res, 500, { ok: false, error: "Handoff mint failed" });
  }
}
