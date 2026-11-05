// SPDX-License-Identifier: AGPL-3.0-only
import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import {
  AinobiCreditsConsumeError,
  consumeAinobiCreditsOnce,
  type CreditsConsumeParams,
  type CreditsConsumeResult,
} from './ainobi-credits.ts';
import {
  enqueueCreditsConsumeRetryJob,
  type CreditsConsumeRetryJob,
  type CreditsConsumeRetryPhase,
  CREDITS_CONSUME_RETRY_WORKER_LOCK_KEY,
  isCreditsConsumeRetryRedisAvailable,
  listDueCreditsConsumeRetryJobs,
  removeCreditsConsumeRetryJob,
  updateCreditsConsumeRetryJob,
} from '../models/credits-consume-retry.ts';

export const DEFAULT_IMMEDIATE_RETRY_COUNT = 3;
export const DEFAULT_RETRY_WORKER_INTERVAL_MS = 60_000;
export const DEFAULT_RETRY_BATCH_SIZE = 5;
export const DEFAULT_RETRY_BASE_BACKOFF_MS = 60_000;
export const DEFAULT_RETRY_MAX_BACKOFF_MS = 30 * 60_000;

export type CreditsConsumeContext = {
  phase?: CreditsConsumeRetryPhase;
  conversationId?: string;
  claudeSessionId?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveImmediateRetryCount(): number {
  const raw = process.env.AINOBI_CREDITS_IMMEDIATE_RETRIES?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed);
    }
  }
  return DEFAULT_IMMEDIATE_RETRY_COUNT;
}

export function resolveRetryWorkerIntervalMs(): number {
  const raw = process.env.AINOBI_CREDITS_RETRY_INTERVAL_MS?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 10_000) {
      return Math.floor(parsed);
    }
  }
  return DEFAULT_RETRY_WORKER_INTERVAL_MS;
}

export function resolveRetryBatchSize(): number {
  const raw = process.env.AINOBI_CREDITS_RETRY_BATCH_SIZE?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(Math.floor(parsed), 50);
    }
  }
  return DEFAULT_RETRY_BATCH_SIZE;
}

function resolveRetryBaseBackoffMs(): number {
  const raw = process.env.AINOBI_CREDITS_RETRY_BASE_BACKOFF_MS?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 1000) {
      return Math.floor(parsed);
    }
  }
  return DEFAULT_RETRY_BASE_BACKOFF_MS;
}

function resolveRetryMaxBackoffMs(): number {
  const raw = process.env.AINOBI_CREDITS_RETRY_MAX_BACKOFF_MS?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 1000) {
      return Math.floor(parsed);
    }
  }
  return DEFAULT_RETRY_MAX_BACKOFF_MS;
}

const DEFAULT_IMMEDIATE_RETRY_BASE_MS = 400;
const DEFAULT_IMMEDIATE_RETRY_MAX_MS = 8_000;
const PREAUTH_IMMEDIATE_RETRY_BASE_MS = 200;
const PREAUTH_IMMEDIATE_RETRY_MAX_MS = 2_000;

function resolveImmediateRetryBaseMs(): number {
  const raw = process.env.AINOBI_CREDITS_IMMEDIATE_RETRY_BASE_MS?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed);
    }
  }
  return DEFAULT_IMMEDIATE_RETRY_BASE_MS;
}

function resolveImmediateRetryMaxMs(): number {
  const raw = process.env.AINOBI_CREDITS_IMMEDIATE_RETRY_MAX_MS?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed);
    }
  }
  return DEFAULT_IMMEDIATE_RETRY_MAX_MS;
}

/** Immediate retry delay before attempt index 1..n (exponential, capped). */
export function immediateRetryDelayMs(
  attemptIndex: number,
  phase: CreditsConsumeRetryPhase = 'direct',
): number {
  const isPreauth = phase === 'preauth';
  const base = isPreauth ? PREAUTH_IMMEDIATE_RETRY_BASE_MS : resolveImmediateRetryBaseMs();
  const max = isPreauth ? PREAUTH_IMMEDIATE_RETRY_MAX_MS : resolveImmediateRetryMaxMs();
  const delay = base * 2 ** Math.max(0, attemptIndex - 1);
  return Math.min(delay, max);
}

/** Background queue backoff after a failed worker attempt. */
export function queueRetryBackoffMs(queueAttemptCount: number): number {
  const base = resolveRetryBaseBackoffMs();
  const max = resolveRetryMaxBackoffMs();
  const exponent = Math.max(0, queueAttemptCount - 1);
  const delay = base * 2 ** exponent;
  const jitter = Math.floor(Math.random() * Math.min(base / 2, 30_000));
  return Math.min(delay + jitter, max);
}

/** Retry transport/5xx; do not retry client/balance errors. */
export function isRetryableCreditsConsumeError(error: unknown): boolean {
  if (!(error instanceof AinobiCreditsConsumeError)) {
    return true;
  }
  const status = error.status;
  if (status === 408 || status === 429) {
    return true;
  }
  if (status >= 500) {
    return true;
  }
  if (status === 502 || status === 503) {
    return true;
  }
  return false;
}

async function tryConsumeOnce(
  accessToken: string,
  params: CreditsConsumeParams,
): Promise<CreditsConsumeResult> {
  return consumeAinobiCreditsOnce(accessToken, params);
}

/**
 * Consume with inline retries, then enqueue to Redis when still failing.
 * Total inline attempts = 1 + immediateRetryCount (default 4).
 */
export async function consumeAinobiCredits(
  accessToken: string,
  params: CreditsConsumeParams,
  context: CreditsConsumeContext = {},
): Promise<CreditsConsumeResult> {
  const phase = context.phase ?? 'direct';
  const immediateRetries = resolveImmediateRetryCount();
  const maxAttempts = 1 + immediateRetries;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await tryConsumeOnce(accessToken, params);
    } catch (error) {
      lastError = error;
      if (!isRetryableCreditsConsumeError(error) || attempt >= maxAttempts) {
        break;
      }
      const delayMs = immediateRetryDelayMs(attempt, phase);
      console.warn(
        `[credits] consume attempt ${attempt}/${maxAttempts} failed; retry in ${delayMs}ms:`,
        error instanceof Error ? error.message : error,
      );
      await sleep(delayMs);
    }
  }

  if (isRetryableCreditsConsumeError(lastError) && isCreditsConsumeRetryRedisAvailable()) {
    const message =
      lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown');
    const status = lastError instanceof AinobiCreditsConsumeError ? lastError.status : undefined;
    await enqueueCreditsConsumeRetryJob({
      accessToken,
      params,
      phase,
      attemptCount: maxAttempts,
      nextRetryAt: Date.now() + queueRetryBackoffMs(maxAttempts),
      lastError: message,
      lastStatus: status,
      conversationId: context.conversationId,
      claudeSessionId: context.claudeSessionId,
    });
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new AinobiCreditsConsumeError('Credits consume failed', 503);
}

/** Consume credits using an authorized session (with inline retry + Redis queue). */
export async function consumeCreditsForSession(
  session: AinobiAuthorizedSession,
  params: CreditsConsumeParams,
  context: CreditsConsumeContext = {},
): Promise<CreditsConsumeResult> {
  return consumeAinobiCredits(session.accessToken, params, context);
}

export async function processCreditsConsumeRetryJob(
  job: CreditsConsumeRetryJob,
): Promise<'completed' | 'rescheduled' | 'dropped'> {
  if (job.nextRetryAt > Date.now()) {
    return 'rescheduled';
  }

  try {
    const result = await tryConsumeOnce(job.accessToken, job.params);
    await removeCreditsConsumeRetryJob(job.id);
    console.info(
      `[credits-retry] job=${job.id} phase=${job.phase} succeeded credits=${result.creditsConsumed}`,
    );
    return 'completed';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof AinobiCreditsConsumeError ? error.status : undefined;

    if (!isRetryableCreditsConsumeError(error)) {
      await removeCreditsConsumeRetryJob(job.id);
      console.warn(
        `[credits-retry] job=${job.id} dropped (non-retryable):`,
        message,
      );
      return 'dropped';
    }

    const attemptCount = job.attemptCount + 1;
    const nextRetryAt = Date.now() + queueRetryBackoffMs(attemptCount);
    await updateCreditsConsumeRetryJob({
      ...job,
      attemptCount,
      nextRetryAt,
      lastError: message,
      lastStatus: status,
    });
    console.warn(
      `[credits-retry] job=${job.id} rescheduled attempt=${attemptCount} next=${new Date(nextRetryAt).toISOString()}:`,
      message,
    );
    return 'rescheduled';
  }
}

let workerTickInProgress = false;

export async function runCreditsConsumeRetryWorkerTick(): Promise<void> {
  if (!isCreditsConsumeRetryRedisAvailable()) {
    return;
  }
  if (workerTickInProgress) {
    return;
  }
  workerTickInProgress = true;

  try {
    const { redisClient } = await import('../db/db.ts');
    if (redisClient.status === 'wait') {
      await redisClient.connect();
    }

    const lockSeconds = Math.max(30, Math.floor(resolveRetryWorkerIntervalMs() / 1000) - 5);
    const acquired = await redisClient.set(
      CREDITS_CONSUME_RETRY_WORKER_LOCK_KEY,
      '1',
      'EX',
      lockSeconds,
      'NX',
    );
    if (acquired !== 'OK') {
      return;
    }

    const batchSize = resolveRetryBatchSize();
    const jobs = await listDueCreditsConsumeRetryJobs(batchSize);
    if (jobs.length === 0) {
      return;
    }

    console.info(`[credits-retry] processing ${jobs.length} due job(s) (batch cap=${batchSize})`);
    for (const job of jobs) {
      await processCreditsConsumeRetryJob(job);
      await sleep(200);
    }
  } catch (error) {
    console.warn(
      '[credits-retry] worker tick failed:',
      error instanceof Error ? error.message : error,
    );
  } finally {
    workerTickInProgress = false;
  }
}

/** Poll Redis every minute (configurable) for failed credit consumes. */
export function startCreditsConsumeRetryWorker(): void {
  if (!isCreditsConsumeRetryRedisAvailable()) {
    return;
  }

  const intervalMs = resolveRetryWorkerIntervalMs();
  void runCreditsConsumeRetryWorkerTick().catch((error) => {
    console.warn(
      '[credits-retry] initial tick failed:',
      error instanceof Error ? error.message : error,
    );
  });

  setInterval(() => {
    void runCreditsConsumeRetryWorkerTick().catch((error) => {
      console.warn(
        '[credits-retry] worker tick failed:',
        error instanceof Error ? error.message : error,
      );
    });
  }, intervalMs);

  console.info(
    `[credits-retry] worker started intervalMs=${intervalMs} batch=${resolveRetryBatchSize()}`,
  );
}
