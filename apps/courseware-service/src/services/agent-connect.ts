// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomBytes } from "node:crypto";

import { redisClient } from "../db/db.ts";
import { ainobiBackendApiUrl } from "../config/ainobi-backend-api.ts";
import { resolveCoursewarePublicBaseUrl } from "./codex-plugin-zip.ts";
import {
  buildMarkdownGuide as buildMarkdownGuideEn,
  type AgentConnectGuideInput,
} from "./agent-connect-guide.ts";

/**
 * Agent connect codes — the "复制接入指令" flow for the console Agent panel.
 *
 * The console mints a code (issueAgentConnectCode): it creates the agent +
 * first credential via the education backend's existing org-agent endpoint
 * using the *manager's own* Bearer token ("create-at-mint"), then stores the
 * plaintext api_key against a one-time code in Redis with a 15-minute TTL.
 * The AI agent later reads `GET /agent/connect/{code}` (markdown guide, no
 * secrets) and downloads the env file via `POST /agent/connect/{code}/credential`.
 *
 * Security model:
 * - The code (~160-bit, RFC4648 base32) is the bearer credential; only its
 *   SHA-256 is stored under the code key. The org index stores the plaintext
 *   code so the console can reuse the same code within the window — this
 *   namespace inherently holds deliverable secrets (the api_key itself) for
 *   at most TTL seconds, same class as the ak→token exchange cache.
 * - Codes are single-use: redemption marks usedAt and deletes the org index
 *   ("用过即换" — the next console page load mints a fresh code).
 * - Expired / used / unknown are indistinguishable from the outside.
 * - Undelivered codes expire with the agent row left in "待接入·…" state;
 *   admins revoke it from the console list (documented slack, not a bug).
 */

const CONNECT_CODE_TTL_SECONDS = 15 * 60;
/** Connect record (the onboarding docs this agent read), kept 7 days for the console's "connect record" view. */
const AGENT_RECORD_TTL_SECONDS = 7 * 24 * 3600;
const CONNECT_KEY_PREFIX = "ainobi-courseware-service:agent-connect:";
const CREDENTIAL_DAYS = 90;

/** `ANB-` + 20 random bytes in RFC4648 base32 (A-Z2-7), grouped 8-8-8-8. */
export const AGENT_CONNECT_CODE_RE = /^ANB-[A-Z2-7]{8}(?:-[A-Z2-7]{8}){3}$/;

export type AgentConnectPayload = {
  api_key: string;
  mcp_url: string;
  org_id: string;
  org_name: string | null;
  owner_user_id: string;
  agent_user_id: string;
  agent_name: string;
  credential_expires_at: string | null;
  minted_at: string;
  used_at: string | null;
};

export type IssuedAgentConnectCode = {
  code: string;
  connectUrl: string;
  expiresAt: string;
  ttlSeconds: number;
  agentName: string;
};

export type ConnectCodeIssueInput = {
  accessToken: string;
  orgId: string;
  /** Console-provided display label (org name, or "个人空间：<owner>"); used in the guide + instruction. */
  orgName?: string | null;
};

export class AgentConnectError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function connectTtlSeconds(): number {
  return CONNECT_CODE_TTL_SECONDS;
}

function codeKey(code: string): string {
  return (
    CONNECT_KEY_PREFIX +
    createHash("sha256").update(code.trim(), "utf8").digest("hex")
  );
}

function orgIndexKey(orgId: string, ownerUserId: string): string {
  return `${CONNECT_KEY_PREFIX}org:${orgId.trim().toLowerCase()}:owner:${ownerUserId.trim().toLowerCase()}`;
}

function buildCode(): string {
  // Node has no built-in base32; map 20 random bytes onto the RFC4648
  // base32 alphabet deterministically -> 32 chars, grouped 8-8-8-8.
  const raw = randomBytes(20);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0n;
  for (const byte of raw) {
    bits = (bits << 8n) | BigInt(byte);
  }
  let out = "";
  for (let i = 0; i < 32; i += 1) {
    out = alphabet[Number((bits >> BigInt(5 * (31 - i))) & 31n)] + out;
  }
  return `ANB-${out.slice(0, 8)}-${out.slice(8, 16)}-${out.slice(16, 24)}-${out.slice(24, 32)}`;
}

// ---------------------------------------------------------------------------
// Redis store (primary) with in-memory fallback — same idiom as agent-handoff.
// ---------------------------------------------------------------------------

type MemoryEntry = { payload: AgentConnectPayload; expiresAtMs: number };

const memoryCodes = new Map<string, MemoryEntry>();
const memoryOrgIndex = new Map<string, { code: string; expiresAtMs: number }>();
const memoryAgentRecords = new Map<
  string,
  { markdown: string; orgId: string; expiresAtMs: number }
>();
let redisStoreBroken = false;

function memoryAlive(entry: MemoryEntry | undefined): MemoryEntry | null {
  if (!entry) return null;
  if (Date.now() >= entry.expiresAtMs) return null;
  return entry;
}

async function withRedisFallback<T>(op: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try {
    if (redisStoreBroken) {
      return await fallback();
    }
    return await op();
  } catch (error) {
    if (!redisStoreBroken) {
      redisStoreBroken = true;
      console.warn(
        "[agent-connect] Redis unavailable, falling back to in-memory store (single-instance only):",
        error instanceof Error ? error.message : error,
      );
    }
    return fallback();
  }
}

async function storePayload(
  key: string,
  payload: AgentConnectPayload,
  ttlSeconds: number,
): Promise<void> {
  await withRedisFallback(
    () => redisClient.set(key, JSON.stringify(payload), "EX", ttlSeconds).then(() => undefined),
    () => {
      memoryCodes.set(key, {
        payload,
        expiresAtMs: Date.now() + ttlSeconds * 1000,
      });
      return Promise.resolve();
    },
  );
}

async function readPayload(key: string): Promise<AgentConnectPayload | null> {
  return withRedisFallback(
    async () => {
      const raw = await redisClient.get(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as AgentConnectPayload;
      } catch {
        return null;
      }
    },
    () => Promise.resolve(memoryAlive(memoryCodes.get(key))?.payload ?? null),
  );
}

type OrgIndexEntry = { code: string; expiresAtMs: number };

async function readOrgIndex(
  orgId: string,
  ownerUserId: string,
): Promise<OrgIndexEntry | null> {
  return withRedisFallback(
    async () => {
      const raw = await redisClient.get(orgIndexKey(orgId, ownerUserId));
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as OrgIndexEntry;
        if (!parsed?.code || !Number.isFinite(parsed.expiresAtMs)) return null; // Old pre-upgrade format: treated as a dead code
        if (Date.now() >= parsed.expiresAtMs) return null;
        return parsed;
      } catch {
        return null;
      }
    },
    async () => {
      const entry = memoryOrgIndex.get(orgIndexKey(orgId, ownerUserId));
      if (!entry || Date.now() >= entry.expiresAtMs) return null;
      return entry;
    },
  );
}

async function writeOrgIndex(
  orgId: string,
  ownerUserId: string,
  code: string,
  ttlSeconds: number,
): Promise<void> {
  const expiresAtMs = Date.now() + ttlSeconds * 1000;
  await withRedisFallback(
    () =>
      redisClient
        .set(
          orgIndexKey(orgId, ownerUserId),
          JSON.stringify({ code, expiresAtMs }),
          "EX",
          ttlSeconds,
        )
        .then(() => undefined),
    () => {
      memoryOrgIndex.set(orgIndexKey(orgId, ownerUserId), {
        code,
        expiresAtMs,
      });
      return Promise.resolve();
    },
  );
}

async function deleteKey(key: string): Promise<void> {
  await withRedisFallback(
    () => redisClient.del(key).then(() => undefined),
    () => {
      memoryCodes.delete(key);
      return Promise.resolve();
    },
  );
}

async function deleteOrgIndex(orgId: string, ownerUserId: string): Promise<void> {
  await withRedisFallback(
    () => redisClient.del(orgIndexKey(orgId, ownerUserId)).then(() => undefined),
    () => {
      memoryOrgIndex.delete(orgIndexKey(orgId, ownerUserId));
      return Promise.resolve();
    },
  );
}

function agentRecordKey(agentUserId: string): string {
  return `${CONNECT_KEY_PREFIX}record:${agentUserId.trim()}`;
}

async function writeAgentRecord(
  agentUserId: string,
  markdown: string,
  orgId: string,
): Promise<void> {
  const key = agentRecordKey(agentUserId);
  await withRedisFallback(
    () =>
      redisClient
        .set(
          key,
          JSON.stringify({ markdown, org_id: orgId }),
          "EX",
          AGENT_RECORD_TTL_SECONDS,
        )
        .then(() => undefined),
    () => {
      memoryAgentRecords.set(key, {
        markdown,
        orgId,
        expiresAtMs: Date.now() + AGENT_RECORD_TTL_SECONDS * 1000,
      });
      return Promise.resolve();
    },
  );
}

/** Connect record view: the onboarding doc this agent read at mint time (7-day window).
 * The caller must pass the target orgId it already passed the gate for — when the agent isn't in that org it is treated as missing,
 * so document content never leaks across orgs. */
export async function getAgentConnectRecord(
  agentUserId: string,
  orgId: string,
): Promise<string | null> {
  const key = agentRecordKey(agentUserId);
  const parsed = await withRedisFallback(
    async () => {
      const raw = await redisClient.get(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as { markdown?: string; org_id?: string };
      } catch {
        return null;
      }
    },
    async () => {
      const entry = memoryAgentRecords.get(key);
      if (!entry || Date.now() >= entry.expiresAtMs) return null;
      return { markdown: entry.markdown, org_id: entry.orgId };
    },
  );
  if (!parsed || (parsed.org_id ?? "").trim().toLowerCase() !== orgId.trim().toLowerCase()) {
    return null;
  }
  return parsed.markdown ?? null;
}

// ---------------------------------------------------------------------------
// Backend issuance (create-at-mint via the manager's own Bearer token)
// ---------------------------------------------------------------------------

type BackendAgentCreatedEnvelope = {
  code?: number;
  success?: boolean;
  message?: string;
  data?: {
    agent?: { agent_user_id?: string; name?: string };
    api_key?: string;
    expires_at?: string | null;
  } | null;
};

async function createAgentInOrgViaBackend(input: {
  accessToken: string;
  orgId: string;
  name: string;
}): Promise<{ apiKey: string; agentUserId: string; expiresAt: string | null }> {
  const url = ainobiBackendApiUrl(
    `/organization/${encodeURIComponent(input.orgId)}/agent`,
  );
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        name: input.name,
        remark: "agent-connect",
        credential_expires_in_days: CREDENTIAL_DAYS,
      }),
    });
  } catch (error) {
    throw new AgentConnectError(
      502,
      "AGENT_CONNECT_BACKEND_UNREACHABLE",
      `Agent credential issuance request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let body: BackendAgentCreatedEnvelope;
  try {
    body = (await response.json()) as BackendAgentCreatedEnvelope;
  } catch {
    throw new AgentConnectError(
      502,
      "AGENT_CONNECT_BACKEND_INVALID",
      "Agent credential issuance returned invalid JSON",
    );
  }

  const data = body.data;
  const apiKey = typeof data?.api_key === "string" ? data.api_key : "";
  const agentUserId =
    typeof data?.agent?.agent_user_id === "string" ? data.agent.agent_user_id : "";
  if (!response.ok || body.code !== 0 || body.success !== true || !apiKey || !agentUserId) {
    // Surface backend rejection (e.g. permission denied) without leaking details.
    const message = body.message?.trim();
    throw new AgentConnectError(
      response.status === 403 ? 403 : 502,
      response.status === 403 ? "FORBIDDEN" : "AGENT_CONNECT_ISSUANCE_FAILED",
      message || `Agent credential issuance rejected (HTTP ${response.status})`,
    );
  }
  return {
    apiKey,
    agentUserId,
    expiresAt: typeof data?.expires_at === "string" ? data.expires_at : null,
  };
}

// ---------------------------------------------------------------------------
// Issue / resolve / redeem
// ---------------------------------------------------------------------------

export function agentConnectMcpUrl(): string {
  return `${resolveCoursewarePublicBaseUrl()}/mcp`;
}

export function agentConnectUrl(code: string): string {
  return `${resolveCoursewarePublicBaseUrl()}/agent/connect/${code}`;
}


export function buildMarkdownGuide(input: AgentConnectGuideInput): string {
  const base = agentConnectUrl(input.code).replace(/\/agent\/connect\/.+$/, "");
  return buildMarkdownGuideEn({ ...input, base });
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function pendingAgentName(now: Date): string {
  return `待接入·${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}`;
}

export function buildAgentConnectInstruction(input: {
  connectUrl: string;
  orgName: string | null;
}): string {
  const orgLabel = input.orgName?.trim() || "组织";
  // Minimal instructions: every operation detail (saving credentials / red lines / skill install / MCP config / verification / naming) is on
  // the connect document page; after reading the link the agent follows the steps naturally — the instructions don't repeat them, sparing the user.
  return (
    `Please connect me to the AINOBI courseware workspace (${orgLabel}).\n` +
    `Read ${input.connectUrl} and follow the steps there to complete the onboarding. Report back to me when done.`
  );
}

/**
 * Return the org's current live code, minting (i.e. creating the agent +
 * credential via the backend) only when none is alive in the window.
 */
export type OrgAgentRow = {
  agent_user_id: string;
  name: string;
  owner_user_id: string | null;
  user_status: string;
  has_active_credential: boolean;
  credential_last_used_at: string | null;
  created_at: string | null;
};

/** Fetch this organization's agent list (the management gate is guaranteed by the caller's manager session). */
async function fetchOrgAgentList(
  orgId: string,
  accessToken: string,
): Promise<OrgAgentRow[]> {
  try {
    const url = new URL(
      ainobiBackendApiUrl(`/organization/${encodeURIComponent(orgId)}/agent/list`),
    );
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    });
    if (!response.ok) {
      return [];
    }
    const body = (await response.json()) as { data?: OrgAgentRow[] | null };
    return Array.isArray(body.data) ? body.data : [];
  } catch (error) {
    console.warn(
      "[agent-connect] agent list fetch failed (non-fatal):",
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

/**
 * Sweep this organization's empty records that "still haven't connected 30 minutes after the code was minted": the agent never redeemed it
 * (credential_last_used_at empty) and was created before the threshold. The caller is a session that just passed the manager
 * gate; its token is used to revoke (soft-delete) them one by one through the backend. Non-fatal: failures are only logged.
 */
const PENDING_SWEEP_MIN_AGE_MS = 30 * 60 * 1000;

async function sweepStalePendingAgents(orgId: string, accessToken: string): Promise<number> {
  try {
    const listUrl = new URL(
      ainobiBackendApiUrl(`/organization/${encodeURIComponent(orgId)}/agent/list`),
    );
    const listResp = await fetch(listUrl, {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    });
    if (!listResp.ok) {
      return 0;
    }
    const listBody = (await listResp.json()) as {
      data?: Array<{
        agent_user_id?: string;
        credential_last_used_at?: string | null;
        created_at?: string;
      }> | null;
    };
    const rows = Array.isArray(listBody.data) ? listBody.data : [];
    const cutoff = Date.now() - PENDING_SWEEP_MIN_AGE_MS;
    let swept = 0;
    for (const row of rows) {
      const agentUserId = row.agent_user_id?.trim();
      // last_used set = the agent really connected (called MCP at least once after redeeming), keep it
      if (!agentUserId || row.credential_last_used_at) {
        continue;
      }
      const createdAt = Date.parse(row.created_at ?? "");
      if (!Number.isFinite(createdAt) || createdAt > cutoff) {
        continue;
      }
      const delUrl = ainobiBackendApiUrl(
        `/organization/${encodeURIComponent(orgId)}/agent/${encodeURIComponent(agentUserId)}`,
      );
      const delResp = await fetch(delUrl, {
        method: "DELETE",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (delResp.ok || delResp.status === 404) {
        swept += 1;
      }
    }
    if (swept > 0) {
      console.info(
        `[agent-connect] swept ${swept} stale pending agent(s) in org ${orgId}`,
      );
    }
    return swept;
  } catch (error) {
    console.warn(
      "[agent-connect] pending sweep failed (non-fatal):",
      error instanceof Error ? error.message : error,
    );
    return 0;
  }
}

export async function issueAgentConnectCode(
  input: ConnectCodeIssueInput & {
    /** Minting user id (console session user) — drives per-user reuse + limits. */
    ownerUserId?: string;
    /** Test-only: replace the backend agent-creation call. */
    _createAgentForTests?: typeof createAgentInOrgViaBackend;
  },
): Promise<IssuedAgentConnectCode> {
  const createAgent = input._createAgentForTests ?? createAgentInOrgViaBackend;
  const orgId = input.orgId.trim();
  if (!orgId) {
    throw new AgentConnectError(400, "ORG_REQUIRED", "org_id is required");
  }
  const ownerUserId = (input.ownerUserId || "anonymous").trim();

  // ★ One agent per person per workspace: if the caller already has an agent in this organization that "really connected"
  // (last_used set = the credential was redeemed and called MCP at least once) → refuse to create another.
  // Pending rows (never used) don't take the slot; dead-code rows past the code TTL are revoked along the way.
  const ownedRows = (await fetchOrgAgentList(orgId, input.accessToken)).filter(
    (row) =>
      (row.owner_user_id ?? "").trim().toLowerCase() ===
      ownerUserId.toLowerCase(),
  );
  const ownedConnected = ownedRows.filter(
    (row) =>
      row.user_status === "active" &&
      !!row.credential_last_used_at &&
      row.has_active_credential !== false,
  );
  if (ownedConnected.length > 0) {
    throw new AgentConnectError(
      409,
      "AGENT_LIMIT_REACHED",
      `每个用户在每个空间限接入一个 Agent(当前:「${ownedConnected[0]!.name}」)。` +
        "如需重新接入,请先在控制台「空间管理 → Agent」吊销旧 Agent。",
    );
  }
  const deadPendingCutoff = Date.now() - connectTtlSeconds() * 1000;
  for (const row of ownedRows) {
    if (row.credential_last_used_at || row.user_status !== "active") {
      continue;
    }
    const createdAt = Date.parse(row.created_at ?? "");
    if (Number.isFinite(createdAt) && createdAt < deadPendingCutoff) {
      // Dead row whose code expired and whose credential can never be delivered: revoke it (complements the organization-level 30-minute sweep)
      const delUrl = ainobiBackendApiUrl(
        `/organization/${encodeURIComponent(orgId)}/agent/${encodeURIComponent(row.agent_user_id)}`,
      );
      await fetch(delUrl, {
        method: "DELETE",
        headers: { authorization: `Bearer ${input.accessToken}` },
      }).catch(() => undefined);
    }
  }

  const existingEntry = await readOrgIndex(orgId, ownerUserId);
  if (existingEntry && AGENT_CONNECT_CODE_RE.test(existingEntry.code)) {
    const payload = await readPayload(codeKey(existingEntry.code));
    if (payload && !payload.used_at) {
      // Return the real expiry (fixed when the index was created) instead of restarting the timer —
      // otherwise every refresh would show a full 15:00 while the code may really die halfway
      const remainingMs = Math.max(0, existingEntry.expiresAtMs - Date.now());
      return {
        code: existingEntry.code,
        connectUrl: agentConnectUrl(existingEntry.code),
        expiresAt: new Date(existingEntry.expiresAtMs).toISOString(),
        ttlSeconds: Math.ceil(remainingMs / 1000),
        agentName: payload.agent_name,
      };
    }
  }

  // Concurrent first-mint fallback: two tabs open in the same org / a race window would make both go through create, producing an
  // orphan agent whose credential can never be delivered. A short SETNX lock makes the loser wait a bit and reread the index (written by
  // the winner); on a lock error or timeout it continues on the original path (best effort, never blocking the main flow).
  const mintLockKey = `${orgIndexKey(orgId, ownerUserId)}:minting`;
  let lockHeld = false;
  try {
    if (!redisStoreBroken) {
      lockHeld = (await redisClient.set(mintLockKey, "1", "EX", 10, "NX")) === "OK";
      if (!lockHeld) {
        for (let i = 0; i < 6; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          const winnerEntry = await readOrgIndex(orgId, ownerUserId);
          if (winnerEntry && AGENT_CONNECT_CODE_RE.test(winnerEntry.code)) {
            const winnerPayload = await readPayload(codeKey(winnerEntry.code));
            if (winnerPayload && !winnerPayload.used_at) {
              const remainingMs = Math.max(0, winnerEntry.expiresAtMs - Date.now());
              return {
                code: winnerEntry.code,
                connectUrl: agentConnectUrl(winnerEntry.code),
                expiresAt: new Date(winnerEntry.expiresAtMs).toISOString(),
                ttlSeconds: Math.ceil(remainingMs / 1000),
                agentName: winnerPayload.agent_name,
              };
            }
          }
        }
      }
    }
  } catch {
    lockHeld = false;
  }

  // Sweep along the way: this organization's leftover unconnected empty records (code minted over 30 minutes ago and never used)
  await sweepStalePendingAgents(orgId, input.accessToken);

  const now = new Date();
  const agentName = pendingAgentName(now);
  const created = await createAgent({
    accessToken: input.accessToken,
    orgId,
    name: agentName,
  });

  const code = buildCode();
  const payload: AgentConnectPayload = {
    api_key: created.apiKey,
    mcp_url: agentConnectMcpUrl(),
    org_id: orgId,
    org_name: input.orgName?.trim() || null,
    owner_user_id: ownerUserId,
    agent_user_id: created.agentUserId,
    agent_name: agentName,
    credential_expires_at: created.expiresAt,
    minted_at: now.toISOString(),
    used_at: null,
  };
  await storePayload(codeKey(code), payload, connectTtlSeconds());
  await writeOrgIndex(orgId, ownerUserId, code, connectTtlSeconds());
  // Connect record: the onboarding doc this agent read at mint time, for the console's "connect record" view for 7 days.
  await writeAgentRecord(
    created.agentUserId,
    buildMarkdownGuide({
      code,
      orgId,
      orgName: payload.org_name,
      mcpUrl: payload.mcp_url,
      credentialExpiresAt: created.expiresAt,
    }),
    orgId,
  );

  if (lockHeld) {
    await withRedisFallback(
      () => redisClient.del(mintLockKey).then(() => undefined),
      () => Promise.resolve(),
    );
  }
  return {
    code,
    connectUrl: agentConnectUrl(code),
    expiresAt: new Date(Date.now() + connectTtlSeconds() * 1000).toISOString(),
    ttlSeconds: connectTtlSeconds(),
    agentName,
  };
}

export type ResolvedAgentConnectCode = {
  code: string;
  payload: AgentConnectPayload;
};

/** Look up a code for the markdown guide. Throws 410 when unknown/expired/used. */
export async function resolveAgentConnectCode(
  code: string,
): Promise<ResolvedAgentConnectCode> {
  if (!AGENT_CONNECT_CODE_RE.test(code.trim())) {
    throw new AgentConnectError(410, "AGENT_CONNECT_CODE_INVALID", "Unknown connect code");
  }
  const payload = await readPayload(codeKey(code));
  if (!payload) {
    throw new AgentConnectError(410, "AGENT_CONNECT_CODE_INVALID", "Unknown connect code");
  }
  return { code: code.trim(), payload };
}

/** Build the two-line env file the agent downloads. */
export function buildCredentialEnvFile(payload: AgentConnectPayload): string {
  return `AINOBI_AGENT_API_KEY=${payload.api_key}\nAINOBI_MCP_URL=${payload.mcp_url}\n`;
}

/**
 * One-time redemption: mark used, drop the org index ("用过即换"), deliver env.
 * Throws 409 on already-used codes (expired/unknown surface as 410 via resolve).
 */
export async function redeemAgentConnectCredential(
  code: string,
  client: string | null,
): Promise<string> {
  const resolved = await resolveAgentConnectCode(code);
  if (resolved.payload.used_at) {
    throw new AgentConnectError(
      409,
      "AGENT_CONNECT_CODE_USED",
      "Connect code already used",
    );
  }
  resolved.payload.used_at = new Date().toISOString();
  await storePayload(
    codeKey(resolved.code),
    resolved.payload,
    connectTtlSeconds(),
  );
  await deleteOrgIndex(resolved.payload.org_id, resolved.payload.owner_user_id);
  // The code is now dead for credential delivery but stays readable for a
  // short "回看" window; the org index removal forces the next console page
  // load to mint a fresh code.
  console.info(
    "[agent-connect] credential delivered: org=%s agent_user_id=%s client=%s",
    resolved.payload.org_id,
    resolved.payload.agent_user_id,
    client?.trim() || "unknown",
  );
  return buildCredentialEnvFile(resolved.payload);
}

/** Test-only: drop all in-memory state and force the fallback store. */
export function resetAgentConnectForTests(): void {
  redisStoreBroken = true;
  memoryCodes.clear();
  memoryOrgIndex.clear();
  memoryAgentRecords.clear();
}

/** Test-only: place a payload directly in the in-memory store (custom TTL for expiry tests). */
export async function _storeAgentConnectCodeForTests(
  code: string,
  payload: AgentConnectPayload,
  ttlSeconds: number,
): Promise<void> {
  redisStoreBroken = true;
  await storePayload(codeKey(code), payload, ttlSeconds);
}
