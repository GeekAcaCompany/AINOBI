// SPDX-License-Identifier: AGPL-3.0-only
import { Redis } from 'ioredis';

import { redisClient } from './db.ts';
import { ensureSharedRedisConnected } from './redis-shared.ts';

const STREAM_PREFIX = 'ainobi:interaction:session';

export type RedisStreamEntry = {
  id: string;
  eventType: string;
  payload: unknown;
};

/** Initial cursor for `XREAD` (`from` query param). */
export const REDIS_STREAM_CURSOR_START = '0';

/** Redis stream key TTL after each publish; refreshed on every event. */
export const REDIS_STREAM_TTL_SECONDS = 3 * 60 * 60;

const nextStreamId = (): string => `${Date.now()}-0`;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export type RedisConnectionConfig = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db: number;
  lazyConnect: boolean;
};

export function chatStreamKeyForSession(chatStreamSessionId: string): string {
  return `${STREAM_PREFIX}:chat:${chatStreamSessionId}:events`;
}

const parseRedisLazyConnect = (): boolean => {
  const raw = process.env.REDIS_LAZY_CONNECT?.trim().toLowerCase();
  if (!raw) {
    return false;
  }
  return raw === 'true' || raw === '1';
};

/** Host-only Redis config for stream publish (not used by ainobi CLI). */
export function resolveRedisConfig(): RedisConnectionConfig | null {
  const host = process.env.REDIS_HOST?.trim();
  if (!host) {
    return null;
  }

  const user = process.env.REDIS_USER?.trim();
  const password = process.env.REDIS_PASSWORD?.trim();

  return {
    host,
    port: Number(process.env.REDIS_PORT || 6379),
    ...(user ? { username: user } : {}),
    ...(password ? { password } : {}),
    db: Number(process.env.REDIS_DB || 0),
    lazyConnect: parseRedisLazyConnect(),
  };
}

export function createRedisClient(): Redis {
  const config = resolveRedisConfig();
  if (!config) {
    throw new Error(
      'Redis is not configured. Set REDIS_HOST (and optionally REDIS_PORT, REDIS_USER, REDIS_PASSWORD, REDIS_DB, REDIS_LAZY_CONNECT).',
    );
  }

  return new Redis({
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    db: config.db,
    lazyConnect: config.lazyConnect,
    maxRetriesPerRequest: 1,
  });
}

function parseStreamFields(fields: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (let index = 0; index < fields.length; index += 2) {
    const key = fields[index];
    const value = fields[index + 1];
    if (key !== undefined && value !== undefined) {
      record[key] = value;
    }
  }
  return record;
}

function parseStreamEntry(id: string, fields: string[]): RedisStreamEntry {
  const record = parseStreamFields(fields);
  const eventType = record.event_type ?? 'unknown';
  let payload: unknown = record.payload ?? null;

  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      // keep raw string
    }
  }

  return { id, eventType, payload };
}

/**
 * Append one SSE-equivalent event to a Redis stream. Returns the Redis entry id, or null when Redis is off.
 */
export async function publishRedisStreamEntry(
  streamKey: string,
  eventType: string,
  payload: unknown,
): Promise<string | null> {
  if (!(await ensureSharedRedisConnected())) {
    return null;
  }

  let streamEntryId: string | null = null;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidateId = nextStreamId();
    try {
      streamEntryId = await redisClient.xadd(
        streamKey,
        candidateId,
        'event_type',
        eventType,
        'payload',
        JSON.stringify(payload),
      );
      break;
    } catch (error) {
      lastError = error;
      await wait(1);
    }
  }

  if (!streamEntryId) {
    throw lastError instanceof Error ? lastError : new Error('Stream XADD did not return a stream id.');
  }

  await redisClient.expire(streamKey, REDIS_STREAM_TTL_SECONDS);

  return streamEntryId;
}

export async function* readRedisStream(
  streamKey: string,
  startId: string,
  signal: AbortSignal,
): AsyncGenerator<RedisStreamEntry> {
  const redis = createRedisClient();

  try {
    if (redis.status === 'wait') {
      await redis.connect();
    }

    let lastId = startId;

    while (!signal.aborted) {
      const result = (await redis.xread(
        'COUNT',
        20,
        'BLOCK',
        5000,
        'STREAMS',
        streamKey,
        lastId,
      )) as [string, [string, string[]][]][] | null;

      if (!result) {
        continue;
      }

      for (const [, entries] of result) {
        for (const [id, fields] of entries) {
          lastId = id;
          yield parseStreamEntry(id, fields);
        }
      }
    }
  } finally {
    redis.disconnect();
  }
}

