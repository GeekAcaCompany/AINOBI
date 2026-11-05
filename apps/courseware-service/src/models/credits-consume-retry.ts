// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';

import { redisClient } from '../db/db.ts';
import type { CreditsConsumeParams } from '../services/ainobi-credits.ts';

/** Redis ZSET: score = nextRetryAt (ms), member = job id. */
export const CREDITS_CONSUME_RETRY_DUE_KEY = 'ainobi:credits:consume:retry:due';

export const creditsConsumeRetryJobKey = (jobId: string): string =>
  `ainobi:credits:consume:retry:job:${jobId.trim()}`;

/** Worker singleton lock (multi-instance safe tick). */
export const CREDITS_CONSUME_RETRY_WORKER_LOCK_KEY = 'ainobi:credits:consume:retry:worker-lock';

export type CreditsConsumeRetryPhase =
  | 'preauth'
  | 'settlement'
  | 'direct'
  | 'google_tts'
  | 'minimax_tts'
  | 'fishaudio_tts'
  | 'tavily_search'
  | 'video_render';

export type CreditsConsumeRetryJob = {
  id: string;
  accessToken: string;
  params: CreditsConsumeParams;
  phase: CreditsConsumeRetryPhase;
  createdAt: number;
  /** Total consume attempts (immediate + background). */
  attemptCount: number;
  nextRetryAt: number;
  lastError?: string;
  lastStatus?: number;
  conversationId?: string;
  claudeSessionId?: string;
};

const JOB_TTL_SECONDS = 7 * 24 * 60 * 60;

export function isCreditsConsumeRetryRedisAvailable(): boolean {
  return Boolean(process.env.REDIS_HOST?.trim());
}

function parseJob(raw: string | null): CreditsConsumeRetryJob | null {
  if (!raw) {
    return null;
  }
  try {
    const job = JSON.parse(raw) as CreditsConsumeRetryJob;
    if (!job?.id || !job.accessToken?.trim() || !job.params?.serviceCode) {
      return null;
    }
    return job;
  } catch {
    return null;
  }
}

export async function enqueueCreditsConsumeRetryJob(
  job: Omit<CreditsConsumeRetryJob, 'id' | 'createdAt' | 'attemptCount' | 'nextRetryAt'> & {
    id?: string;
    createdAt?: number;
    attemptCount?: number;
    nextRetryAt?: number;
  },
): Promise<string | null> {
  if (!isCreditsConsumeRetryRedisAvailable()) {
    console.warn('[credits-retry] Redis not configured; dropping failed consume job');
    return null;
  }

  const id = job.id?.trim() || randomUUID();
  const createdAt = job.createdAt ?? Date.now();
  const attemptCount = job.attemptCount ?? 0;
  const nextRetryAt = job.nextRetryAt ?? Date.now();
  const record: CreditsConsumeRetryJob = {
    id,
    accessToken: job.accessToken.trim(),
    params: job.params,
    phase: job.phase,
    createdAt,
    attemptCount,
    nextRetryAt,
    lastError: job.lastError,
    lastStatus: job.lastStatus,
    conversationId: job.conversationId?.trim() || undefined,
    claudeSessionId: job.claudeSessionId?.trim() || undefined,
  };

  try {
    if (redisClient.status === 'wait') {
      await redisClient.connect();
    }
    const payload = JSON.stringify(record);
    await redisClient
      .multi()
      .set(creditsConsumeRetryJobKey(id), payload, 'EX', JOB_TTL_SECONDS)
      .zadd(CREDITS_CONSUME_RETRY_DUE_KEY, nextRetryAt, id)
      .exec();
    console.warn(
      `[credits-retry] enqueued job=${id} phase=${record.phase} next=${new Date(nextRetryAt).toISOString()}`,
    );
    return id;
  } catch (error) {
    console.warn(
      '[credits-retry] enqueue failed:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export async function getCreditsConsumeRetryJob(jobId: string): Promise<CreditsConsumeRetryJob | null> {
  if (!isCreditsConsumeRetryRedisAvailable()) {
    return null;
  }
  try {
    if (redisClient.status === 'wait') {
      await redisClient.connect();
    }
    const raw = await redisClient.get(creditsConsumeRetryJobKey(jobId));
    return parseJob(raw);
  } catch {
    return null;
  }
}

export async function updateCreditsConsumeRetryJob(job: CreditsConsumeRetryJob): Promise<void> {
  if (!isCreditsConsumeRetryRedisAvailable()) {
    return;
  }
  try {
    if (redisClient.status === 'wait') {
      await redisClient.connect();
    }
    await redisClient
      .multi()
      .set(creditsConsumeRetryJobKey(job.id), JSON.stringify(job), 'EX', JOB_TTL_SECONDS)
      .zadd(CREDITS_CONSUME_RETRY_DUE_KEY, job.nextRetryAt, job.id)
      .exec();
  } catch (error) {
    console.warn(
      '[credits-retry] update failed:',
      error instanceof Error ? error.message : error,
    );
  }
}

export async function removeCreditsConsumeRetryJob(jobId: string): Promise<void> {
  if (!isCreditsConsumeRetryRedisAvailable()) {
    return;
  }
  try {
    if (redisClient.status === 'wait') {
      await redisClient.connect();
    }
    await redisClient
      .multi()
      .del(creditsConsumeRetryJobKey(jobId))
      .zrem(CREDITS_CONSUME_RETRY_DUE_KEY, jobId)
      .exec();
  } catch (error) {
    console.warn(
      '[credits-retry] remove failed:',
      error instanceof Error ? error.message : error,
    );
  }
}

/** Jobs whose nextRetryAt <= now, oldest first. */
export async function listDueCreditsConsumeRetryJobs(limit: number): Promise<CreditsConsumeRetryJob[]> {
  if (!isCreditsConsumeRetryRedisAvailable() || limit <= 0) {
    return [];
  }

  try {
    if (redisClient.status === 'wait') {
      await redisClient.connect();
    }
    const now = Date.now();
    const ids = await redisClient.zrangebyscore(
      CREDITS_CONSUME_RETRY_DUE_KEY,
      0,
      now,
      'LIMIT',
      0,
      limit,
    );
    if (ids.length === 0) {
      return [];
    }

    const keys = ids.map((id) => creditsConsumeRetryJobKey(id));
    const payloads = await redisClient.mget(...keys);
    const jobs: CreditsConsumeRetryJob[] = [];
    for (let i = 0; i < ids.length; i += 1) {
      const job = parseJob(payloads[i] ?? null);
      if (job) {
        jobs.push(job);
      } else {
        await redisClient.zrem(CREDITS_CONSUME_RETRY_DUE_KEY, ids[i]);
      }
    }
    return jobs;
  } catch (error) {
    console.warn(
      '[credits-retry] list due failed:',
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

export async function countPendingCreditsConsumeRetryJobs(): Promise<number> {
  if (!isCreditsConsumeRetryRedisAvailable()) {
    return 0;
  }
  try {
    if (redisClient.status === 'wait') {
      await redisClient.connect();
    }
    return await redisClient.zcard(CREDITS_CONSUME_RETRY_DUE_KEY);
  } catch {
    return 0;
  }
}
