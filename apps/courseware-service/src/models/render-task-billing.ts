// SPDX-License-Identifier: AGPL-3.0-only
import { redisClient } from '../db/db.ts';

/**
 * One video-render task is settled at most once (credits + org storage) when courseware-agent
 * first learns it reached `completed` (webhook from ainobi-video-render-service, or a lazy check
 * while listing tasks). Settlement needs the *original* requester's access token, which is only
 * available on the create-task request — long gone by the time an async render finishes — so we
 * stash a copy here at creation time and consume it exactly once via
 * {@link takePendingRenderTaskBilling}.
 */
export type PendingRenderTaskBilling = {
  accessToken: string;
  orgId: string | undefined;
  coursewareId: string;
  userId: string | undefined;
};

const renderTaskBillingKey = (taskId: string): string =>
  `ainobi:render-task-billing:pending:${taskId.trim()}`;

/** The slice of the ioredis surface this store actually uses. */
type RenderTaskBillingRedis = {
  status: string;
  connect(): Promise<unknown>;
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
  eval(script: string, numKeys: number, key: string): Promise<unknown>;
};

let redisOverrideForTests: RenderTaskBillingRedis | null = null;

/**
 * Unit-test seam (same convention as __setPersistWriterForTests): inject an
 * in-memory fake so the billing tests never need a live Redis — CI runners
 * have none, and each real connection attempt burns ~80s of ioredis retries
 * before the billing degrades to 'skipped'. Pass null to restore the real
 * client.
 */
export function __setRenderTaskBillingRedisForTests(
  client: RenderTaskBillingRedis | null,
): void {
  redisOverrideForTests = client;
}

function billingRedis(): RenderTaskBillingRedis {
  return redisOverrideForTests ?? (redisClient as unknown as RenderTaskBillingRedis);
}

// Matches the retry/backoff window a task can realistically still be sitting in `failed`/
// `interrupted` waiting for a manual retry before someone gives up on it.
const PENDING_BILLING_TTL_SECONDS = 7 * 24 * 60 * 60;

export function isRenderTaskBillingRedisAvailable(): boolean {
  return Boolean(process.env.REDIS_HOST?.trim());
}

/** Normalize tokens written by older builds that prefixed plaintext with `plain:`. */
function normalizeStoredAccessToken(stored: string): string | null {
  if (stored.startsWith('enc:')) {
    // Pre-removal AES-GCM records are no longer decryptable; skip billing for those tasks.
    console.warn(
      '[render-task-billing] ignoring legacy encrypted access token; task will not be billed',
    );
    return null;
  }
  if (stored.startsWith('plain:')) {
    return stored.slice('plain:'.length);
  }
  return stored;
}

function parseRecord(raw: string | null): PendingRenderTaskBilling | null {
  if (!raw) {
    return null;
  }
  try {
    const stored = JSON.parse(raw) as PendingRenderTaskBilling;
    if (!stored?.accessToken?.trim() || !stored.coursewareId?.trim()) {
      return null;
    }
    const accessToken = normalizeStoredAccessToken(stored.accessToken);
    if (!accessToken) {
      return null;
    }
    return { ...stored, accessToken };
  } catch (error) {
    console.warn(
      '[render-task-billing] failed to parse pending billing record:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/** Called once, when the render task is created (while the requester's session is still live). */
export async function savePendingRenderTaskBilling(
  taskId: string,
  billing: PendingRenderTaskBilling,
): Promise<void> {
  if (!isRenderTaskBillingRedisAvailable()) {
    console.warn('[render-task-billing] Redis not configured; render task will not be billed on completion');
    return;
  }
  try {
    const redis = billingRedis();
    if (redis.status === 'wait') {
      await redis.connect();
    }
    await redis.set(
      renderTaskBillingKey(taskId),
      JSON.stringify(billing),
      'EX',
      PENDING_BILLING_TTL_SECONDS,
    );
  } catch (error) {
    console.warn(
      `[render-task-billing] failed to save pending billing for task=${taskId}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

const GETDEL_SCRIPT = `
local v = redis.call('GET', KEYS[1])
if v then redis.call('DEL', KEYS[1]) end
return v
`;

/**
 * Atomically fetches and deletes the pending billing record for a task, so concurrent callers
 * (webhook + lazy list-fallback racing each other) can only ever have one of them "win" and
 * actually attempt to bill — the loser gets `null` back and no-ops. Returns `null` when there was
 * nothing pending (already billed, billing was disabled/anonymous at creation time, or expired).
 */
export async function takePendingRenderTaskBilling(
  taskId: string,
): Promise<PendingRenderTaskBilling | null> {
  if (!isRenderTaskBillingRedisAvailable()) {
    return null;
  }
  try {
    const redis = billingRedis();
    if (redis.status === 'wait') {
      await redis.connect();
    }
    const raw = (await redis.eval(GETDEL_SCRIPT, 1, renderTaskBillingKey(taskId))) as
      | string
      | null;
    return parseRecord(raw);
  } catch (error) {
    console.warn(
      `[render-task-billing] failed to take pending billing for task=${taskId}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
