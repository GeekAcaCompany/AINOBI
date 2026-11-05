// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';

import { ainobiBackendApiUrl } from '../config/ainobi-backend-api.ts';
import { redisClient } from '../db/db.ts';

/** Long-lived org Agent credential prefix (education `API_KEY_PREFIX`). */
export const AINOBI_AGENT_API_KEY_PREFIX = 'ainobi_ak_';

const AK_CACHE_KEY_PREFIX = 'ainobi-courseware-agent:agent-ak:';
/** Refresh before education's 60m token expires. */
const ACCESS_TOKEN_SKEW_SECONDS = 120;
const DEFAULT_EXPIRES_IN_SECONDS = 3600;

type AgentTokenApiResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  agent_user_id?: string;
  owner_user_id?: string;
  current_org_id?: string;
};

/** Education returns top-level fields today; tolerate a `{ data }` envelope too. */
type AgentTokenApiEnvelope = AgentTokenApiResponse & {
  code?: number;
  success?: boolean;
  data?: AgentTokenApiResponse | null;
};

type CachedExchangedToken = {
  accessToken: string;
  expireAt: string;
};

const memoryAkCache = new Map<string, CachedExchangedToken>();

/** Parse `POST /agent/token` JSON whether unwrapped or SuccessWrapped. */
export function parseAgentTokenResponse(body: unknown): {
  accessToken: string;
  expiresIn: number;
} | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const envelope = body as AgentTokenApiEnvelope;
  const payload =
    envelope.data && typeof envelope.data === 'object' ? envelope.data : envelope;
  const accessToken =
    typeof payload.access_token === 'string' ? payload.access_token.trim() : '';
  if (!accessToken) {
    return null;
  }
  const expiresIn =
    typeof payload.expires_in === 'number' && payload.expires_in > 0
      ? payload.expires_in
      : DEFAULT_EXPIRES_IN_SECONDS;
  return { accessToken, expiresIn };
}

export function isAinobiAgentApiKey(token: string | undefined | null): boolean {
  return Boolean(token?.trim().startsWith(AINOBI_AGENT_API_KEY_PREFIX));
}

/** Log-safe fingerprint: prefix + last 4 chars only. */
export function redactAinobiAgentApiKey(apiKey: string): string {
  const key = apiKey.trim();
  if (!key) {
    return '(empty)';
  }
  if (key.length <= 12) {
    return `${AINOBI_AGENT_API_KEY_PREFIX}…`;
  }
  return `${key.slice(0, AINOBI_AGENT_API_KEY_PREFIX.length + 4)}…${key.slice(-4)}`;
}

function akCacheKey(apiKey: string): string {
  const digest = createHash('sha256').update(apiKey, 'utf8').digest('hex');
  return `${AK_CACHE_KEY_PREFIX}${digest}`;
}

function memoryCacheKey(apiKey: string): string {
  return createHash('sha256').update(apiKey, 'utf8').digest('hex');
}

function expireAtFromExpiresIn(expiresInSeconds: number): string {
  const ttl = Math.max(1, expiresInSeconds - ACCESS_TOKEN_SKEW_SECONDS);
  return new Date(Date.now() + ttl * 1000).toISOString();
}

function cacheTtlSeconds(expireAt: string): number | null {
  const expiresMs = Date.parse(expireAt);
  if (!Number.isFinite(expiresMs)) {
    return null;
  }
  const ttlMs = expiresMs - Date.now();
  if (ttlMs <= 0) {
    return null;
  }
  return Math.max(1, Math.ceil(ttlMs / 1000));
}

async function readCachedExchange(apiKey: string): Promise<CachedExchangedToken | null> {
  const mem = memoryAkCache.get(memoryCacheKey(apiKey));
  if (mem && Date.parse(mem.expireAt) > Date.now()) {
    return mem;
  }

  try {
    const raw = await redisClient.get(akCacheKey(apiKey));
    if (!raw) {
      return null;
    }
    const cached = JSON.parse(raw) as CachedExchangedToken;
    if (!cached?.accessToken || !cached.expireAt) {
      return null;
    }
    if (Date.parse(cached.expireAt) <= Date.now()) {
      return null;
    }
    memoryAkCache.set(memoryCacheKey(apiKey), cached);
    return cached;
  } catch (error) {
    console.warn(
      '[auth] Redis agent-ak cache read failed:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

async function writeCachedExchange(apiKey: string, cached: CachedExchangedToken): Promise<void> {
  memoryAkCache.set(memoryCacheKey(apiKey), cached);
  const ttlSeconds = cacheTtlSeconds(cached.expireAt);
  if (!ttlSeconds) {
    return;
  }
  try {
    await redisClient.set(akCacheKey(apiKey), JSON.stringify(cached), 'EX', ttlSeconds);
  } catch (error) {
    console.warn(
      '[auth] Redis agent-ak cache write failed:',
      error instanceof Error ? error.message : error,
    );
  }
}

/** Drop ak→access_token cache (revoke / check_session failure). */
export async function invalidateCachedAgentApiKeyExchange(apiKey: string): Promise<void> {
  const key = apiKey.trim();
  if (!isAinobiAgentApiKey(key)) {
    return;
  }
  memoryAkCache.delete(memoryCacheKey(key));
  try {
    await redisClient.del(akCacheKey(key));
  } catch (error) {
    console.warn(
      '[auth] Redis agent-ak cache invalidate failed:',
      error instanceof Error ? error.message : error,
    );
  }
}

/** Drop the ak→handoff-token cache (credential revoke / tests). */
export async function invalidateCachedAgentHandoffToken(apiKey: string): Promise<void> {
  const key = apiKey.trim();
  if (!isAinobiAgentApiKey(key)) {
    return;
  }
  memoryHandoffCache.delete(memoryCacheKey(key));
  try {
    await redisClient.del(handoffCacheKey(key));
  } catch (error) {
    console.warn(
      '[auth] Redis agent-handoff cache invalidate failed:',
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Exchange a long-lived org Agent `ainobi_ak_*` for a short-lived access_token
 * via education `POST /agent/token`.
 */
export async function exchangeAgentApiKeyForAccessToken(
  apiKey: string,
): Promise<string | null> {
  const key = apiKey.trim();
  if (!isAinobiAgentApiKey(key)) {
    return null;
  }

  const cached = await readCachedExchange(key);
  if (cached) {
    return cached.accessToken;
  }

  const url = ainobiBackendApiUrl('/agent/token');
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ api_key: key }),
    });
  } catch (error) {
    console.warn(
      `[auth] agent/token request failed for ${redactAinobiAgentApiKey(key)}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    console.warn(
      `[auth] agent/token non-JSON response for ${redactAinobiAgentApiKey(key)} status=${response.status}`,
    );
    return null;
  }

  const parsed = parseAgentTokenResponse(body);
  if (!response.ok || !parsed) {
    console.warn(
      `[auth] agent/token rejected for ${redactAinobiAgentApiKey(key)} status=${response.status}`,
    );
    return null;
  }

  await writeCachedExchange(key, {
    accessToken: parsed.accessToken,
    expireAt: expireAtFromExpiresIn(parsed.expiresIn),
  });
  return parsed.accessToken;
}

/**
 * Resolve Authorization Bearer to a short-lived access_token.
 * Org Agent api_keys are exchanged; other tokens pass through.
 */
export async function resolveBearerToAccessToken(
  bearer: string,
): Promise<string | null> {
  const token = bearer.trim();
  if (!token) {
    return null;
  }
  if (isAinobiAgentApiKey(token)) {
    return exchangeAgentApiKeyForAccessToken(token);
  }
  return token;
}

// --- Handoff token: human-cycle TTL for courseware_ui_links ---------------

const HANDOFF_CACHE_KEY_PREFIX = 'ainobi-courseware-agent:agent-handoff-tt:';
const HANDOFF_DEFAULT_EXPIRES_IN_MINUTES = 10080;
const memoryHandoffCache = new Map<string, CachedExchangedToken>();

function handoffCacheKey(apiKey: string): string {
  const digest = createHash('sha256').update(apiKey, 'utf8').digest('hex');
  return `${HANDOFF_CACHE_KEY_PREFIX}${digest}`;
}

/**
 * Requested handoff-token TTL in minutes (education clamps it to the human
 * ``ACCESS_TOKEN_EXPIRE_MINUTES`` ceiling). Env-overridable for stacks where
 * the human cycle differs from the default 7 days.
 */
export function agentHandoffTokenMinutes(): number {
  const raw = Number(process.env.AINOBI_AGENT_HANDOFF_TOKEN_MINUTES);
  if (Number.isFinite(raw) && raw >= 1) {
    return Math.floor(raw);
  }
  return HANDOFF_DEFAULT_EXPIRES_IN_MINUTES;
}

async function readCachedHandoffToken(apiKey: string): Promise<CachedExchangedToken | null> {
  const mem = memoryHandoffCache.get(memoryCacheKey(apiKey));
  if (mem && Date.parse(mem.expireAt) > Date.now()) {
    return mem;
  }
  try {
    const raw = await redisClient.get(handoffCacheKey(apiKey));
    if (!raw) {
      return null;
    }
    const cached = JSON.parse(raw) as CachedExchangedToken;
    if (!cached?.accessToken || !cached.expireAt) {
      return null;
    }
    if (Date.parse(cached.expireAt) <= Date.now()) {
      return null;
    }
    memoryHandoffCache.set(memoryCacheKey(apiKey), cached);
    return cached;
  } catch (error) {
    console.warn(
      '[auth] Redis agent-handoff cache read failed:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

async function writeCachedHandoffToken(
  apiKey: string,
  cached: CachedExchangedToken,
): Promise<void> {
  memoryHandoffCache.set(memoryCacheKey(apiKey), cached);
  const ttlSeconds = cacheTtlSeconds(cached.expireAt);
  if (!ttlSeconds) {
    return;
  }
  try {
    await redisClient.set(handoffCacheKey(apiKey), JSON.stringify(cached), 'EX', ttlSeconds);
  } catch (error) {
    console.warn(
      '[auth] Redis agent-handoff cache write failed:',
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Exchange an org Agent `ainobi_ak_*` for a LONG-lived access_token used to
 * seed handoff codes: education clamps ``expires_in_minutes`` to the human
 * ``ACCESS_TOKEN_EXPIRE_MINUTES``, so browser sessions opened via
 * ``?handoff=`` live as long as a human login. Cached per credential — every
 * ui_links call reuses one long-lived session instead of minting new ones.
 * Returns null on failure; callers fall back to the short working token.
 */
export async function exchangeAgentApiKeyForHandoffAccessToken(
  apiKey: string,
  expiresInMinutes: number,
): Promise<string | null> {
  const key = apiKey.trim();
  if (!isAinobiAgentApiKey(key)) {
    return null;
  }

  const cached = await readCachedHandoffToken(key);
  if (cached) {
    return cached.accessToken;
  }

  const url = ainobiBackendApiUrl('/agent/token');
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        api_key: key,
        expires_in_minutes: Math.max(1, Math.floor(expiresInMinutes)),
      }),
    });
  } catch (error) {
    console.warn(
      `[auth] agent/token (handoff) request failed for ${redactAinobiAgentApiKey(key)}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    console.warn(
      `[auth] agent/token (handoff) non-JSON response for ${redactAinobiAgentApiKey(key)} status=${response.status}`,
    );
    return null;
  }

  const parsed = parseAgentTokenResponse(body);
  if (!response.ok || !parsed) {
    console.warn(
      `[auth] agent/token (handoff) rejected for ${redactAinobiAgentApiKey(key)} status=${response.status}`,
    );
    return null;
  }

  await writeCachedHandoffToken(key, {
    accessToken: parsed.accessToken,
    expireAt: expireAtFromExpiresIn(parsed.expiresIn),
  });
  return parsed.accessToken;
}
