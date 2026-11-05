// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomBytes } from "node:crypto";

import { redisClient } from "../db/db.ts";

/**
 * Login-free browser handoff for agent-authored courseware.
 *
 * Codex (via MCP `courseware_ui_links`) receives a URL of the shape
 * `https://<student>/courseware-preview?courseware_id=…&handoff=<code>`.
 * The frontend boot code (AuthContext / manage session-manager) detects the
 * `handoff` query param and redeems the code here for the underlying
 * short-lived access_token — the token itself never appears in any URL.
 *
 * The code is a high-entropy bearer credential: stored hashed, short TTL,
 * and redeemable only a bounded number of times (browser refreshes, prefetch
 * bots, and re-opened tabs share the same budget). It only ever delivers the
 * same access_token that minted it, so a leaked code is equivalent to a
 * leaked short-lived agent token, with a much smaller window.
 */

const HANDOFF_KEY_PREFIX = "ainobi-courseware-agent:agent-handoff:";
const DEFAULT_TTL_SECONDS = 5 * 60;
const DEFAULT_MAX_REDEMPTIONS = 5;
const CODE_BYTES = 32;

export type AgentHandoffPayload = {
  access_token: string;
  owner_user_id: string;
  courseware_id: string;
  org_id: string | null;
  minted_at: string;
  /** This code's redemption budget (written at mint time; old payloads without it use the env config). */
  max_redemptions?: number;
};

export type MintedAgentHandoff = {
  code: string;
  expiresAt: string;
  ttlSeconds: number;
  maxRedemptions: number;
};

type HandoffStore = {
  set(key: string, payload: AgentHandoffPayload, ttlSeconds: number): Promise<void>;
  get(key: string): Promise<AgentHandoffPayload | null>;
  /** Increment a redemption counter; returns the new count (1 on first). */
  incr(key: string, ttlSeconds: number): Promise<number>;
  reset?(): void;
};

function handoffTtlSeconds(): number {
  const n = Number(process.env.AINOBI_AGENT_HANDOFF_TTL_SECONDS);
  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_TTL_SECONDS;
  }
  return Math.min(3600, Math.max(10, Math.floor(n)));
}

function handoffMaxRedemptions(): number {
  const n = Number(process.env.AINOBI_AGENT_HANDOFF_MAX_REDEMPTIONS);
  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_MAX_REDEMPTIONS;
  }
  return Math.min(20, Math.max(1, Math.floor(n)));
}

/** Handoff codes are base64url of 32 random bytes (43 chars, no padding). */
export function isSafeAgentHandoffCode(code: string | null | undefined): code is string {
  return typeof code === "string" && /^[A-Za-z0-9_-]{40,64}$/.test(code.trim());
}

function handoffKey(code: string): string {
  return HANDOFF_KEY_PREFIX + createHash("sha256").update(code.trim(), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Redis store (primary) with in-memory fallback for dev / Redis outages.
// ---------------------------------------------------------------------------

class RedisHandoffStore implements HandoffStore {
  async set(key: string, payload: AgentHandoffPayload, ttlSeconds: number): Promise<void> {
    await redisClient.set(key, JSON.stringify(payload), "EX", ttlSeconds);
  }

  async get(key: string): Promise<AgentHandoffPayload | null> {
    const raw = await redisClient.get(key);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as AgentHandoffPayload;
    } catch {
      return null;
    }
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const count = await redisClient.incr(key);
    if (count === 1) {
      await redisClient.expire(key, ttlSeconds);
    }
    return count;
  }
}

class MemoryHandoffStore implements HandoffStore {
  #entries = new Map<string, { payload: AgentHandoffPayload; expiresAtMs: number }>();
  #counters = new Map<string, { count: number; expiresAtMs: number }>();

  async set(key: string, payload: AgentHandoffPayload, ttlSeconds: number): Promise<void> {
    this.#entries.set(key, { payload, expiresAtMs: Date.now() + ttlSeconds * 1000 });
  }

  async get(key: string): Promise<AgentHandoffPayload | null> {
    const entry = this.#entries.get(key);
    if (!entry) {
      return null;
    }
    if (Date.now() >= entry.expiresAtMs) {
      this.#entries.delete(key);
      this.#counters.delete(`${key}:n`);
      return null;
    }
    return entry.payload;
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const now = Date.now();
    const existing = this.#counters.get(key);
    if (!existing || now >= existing.expiresAtMs) {
      this.#counters.set(key, { count: 1, expiresAtMs: now + ttlSeconds * 1000 });
      return 1;
    }
    existing.count += 1;
    return existing.count;
  }

  reset(): void {
    this.#entries.clear();
    this.#counters.clear();
  }
}

const redisStore = new RedisHandoffStore();
const memoryStore = new MemoryHandoffStore();
let redisStoreBroken = false;

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
        "[agent-handoff] Redis unavailable, falling back to in-memory store (single-instance only):",
        error instanceof Error ? error.message : error,
      );
    }
    return fallback();
  }
}

// ---------------------------------------------------------------------------
// Mint / redeem
// ---------------------------------------------------------------------------

/**
 * Mint a handoff code that delivers `payload` to the redeeming browser.
 * The code is returned in plaintext exactly once; only its hash is stored.
 */
export async function mintAgentHandoff(
  payload: {
    accessToken: string;
    ownerUserId: string;
    coursewareId: string;
    orgId: string | null;
  },
  options?: { ttlSeconds?: number; maxRedemptions?: number },
): Promise<MintedAgentHandoff> {
  const ttlSeconds = Math.min(
    3600,
    Math.max(10, Math.floor(options?.ttlSeconds ?? handoffTtlSeconds())),
  );
  const maxRedemptions = Math.min(
    50,
    Math.max(1, Math.floor(options?.maxRedemptions ?? handoffMaxRedemptions())),
  );
  const code = randomBytes(CODE_BYTES).toString("base64url");
  const stored: AgentHandoffPayload = {
    access_token: payload.accessToken,
    owner_user_id: payload.ownerUserId,
    courseware_id: payload.coursewareId,
    org_id: payload.orgId,
    minted_at: new Date().toISOString(),
    max_redemptions: maxRedemptions,
  };
  await withRedisFallback(
    () => redisStore.set(handoffKey(code), stored, ttlSeconds),
    () => memoryStore.set(handoffKey(code), stored, ttlSeconds),
  );
  return {
    code,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    ttlSeconds,
    maxRedemptions,
  };
}

/**
 * Redeem a code: returns the payload when the code is valid, unexpired, and
 * within its redemption budget; `null` otherwise (indistinguishable — do not
 * leak which check failed).
 */
export async function redeemAgentHandoff(code: string): Promise<AgentHandoffPayload | null> {
  if (!isSafeAgentHandoffCode(code)) {
    return null;
  }
  const key = handoffKey(code);
  const ttlSeconds = handoffTtlSeconds();
  const payload = await withRedisFallback(
    () => redisStore.get(key),
    () => memoryStore.get(key),
  );
  if (!payload) {
    return null;
  }
  const count = await withRedisFallback(
    () => redisStore.incr(`${key}:n`, ttlSeconds),
    () => memoryStore.incr(`${key}:n`, ttlSeconds),
  );
  if (count > (payload.max_redemptions ?? handoffMaxRedemptions())) {
    return null;
  }
  return payload;
}

/** Test-only: force the in-memory store and drop all state. */
export function resetAgentHandoffForTests(): void {
  redisStoreBroken = true;
  memoryStore.reset();
}

/** Test-only: mint into the in-memory store with an explicit TTL (bypasses env floor) for expiry tests. */
export async function _mintAgentHandoffForTests(
  payload: {
    accessToken: string;
    ownerUserId: string;
    coursewareId: string;
    orgId: string | null;
  },
  ttlSeconds: number,
): Promise<string> {
  const code = randomBytes(CODE_BYTES).toString("base64url");
  const stored: AgentHandoffPayload = {
    access_token: payload.accessToken,
    owner_user_id: payload.ownerUserId,
    courseware_id: payload.coursewareId,
    org_id: payload.orgId,
    minted_at: new Date().toISOString(),
  };
  await memoryStore.set(handoffKey(code), stored, ttlSeconds);
  return code;
}
