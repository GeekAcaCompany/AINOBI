// SPDX-License-Identifier: AGPL-3.0-only
import { redisClient } from './db.ts';
import { resolveRedisConfig } from './redis-stream.ts';

/** Ensures the process-wide Redis client is connected when REDIS_HOST is configured. */
export async function ensureSharedRedisConnected(): Promise<boolean> {
  if (!resolveRedisConfig()) {
    return false;
  }
  try {
    if (redisClient.status === 'wait') {
      await redisClient.connect();
    }
    return true;
  } catch (error) {
    console.warn(
      '[redis] shared client connect failed:',
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}
