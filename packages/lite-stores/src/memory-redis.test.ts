// SPDX-License-Identifier: AGPL-3.0-only
// Drives the server through the real ioredis client. Every assertion is a statement about Redis:
// set LITE_STORES_REAL_REDIS_URL (with a throwaway db, for example redis://127.0.0.1:6379/15) to
// run the same suite against a real server and prove the two agree.
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startMemoryRedis, type MemoryRedisServer } from './memory-redis.ts';

const realUrl = process.env.LITE_STORES_REAL_REDIS_URL;
let server: MemoryRedisServer | undefined;
const clients: Redis[] = [];

function connect(): Redis {
  const client = realUrl
    ? new Redis(realUrl)
    : new Redis({ host: server?.host, port: server?.port, db: 1 });
  clients.push(client);
  return client;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const key = (): string => `lite-stores-test:${randomUUID()}`;

beforeAll(async () => {
  if (!realUrl) server = await startMemoryRedis();
});

afterEach(() => {
  for (const client of clients.splice(0)) client.disconnect();
});

afterAll(async () => {
  await server?.close();
});

describe('strings and expiry', () => {
  it('honours SET options', async () => {
    const redis = connect();
    const k = key();
    expect(await redis.set(k, 'a', 'EX', 60, 'NX')).toBe('OK');
    expect(await redis.set(k, 'b', 'EX', 60, 'NX')).toBeNull();
    expect(await redis.get(k)).toBe('a');
    expect(await redis.set(k, 'b', 'XX')).toBe('OK');
    expect(await redis.ttl(k)).toBe(-1);
    await redis.expire(k, 60);
    expect(await redis.set(k, 'c', 'KEEPTTL')).toBe('OK');
    expect(await redis.ttl(k)).toBeGreaterThan(50);
    await redis.del(k);
    expect(await redis.set(k, 'x', 'XX')).toBeNull();
  });

  it('keeps multibyte values intact', async () => {
    const redis = connect();
    const k = key();
    const value = JSON.stringify({ text: '日本語と中文 🎓', crlf: '\r\n' });
    await redis.set(k, value);
    expect(await redis.get(k)).toBe(value);
    await redis.del(k);
  });

  it('expires keys and reports TTL states', async () => {
    const redis = connect();
    const k = key();
    expect(await redis.ttl(k)).toBe(-2);
    await redis.set(k, 'v', 'PX', 60);
    expect(await redis.exists(k)).toBe(1);
    await sleep(120);
    expect(await redis.get(k)).toBeNull();
    expect(await redis.ttl(k)).toBe(-2);
    await redis.setex(k, 100, 'v');
    expect(await redis.ttl(k)).toBeGreaterThan(90);
    expect(await redis.expire(k, 0)).toBe(1);
    expect(await redis.exists(k)).toBe(0);
    expect(await redis.expire(k, 10)).toBe(0);
  });

  it('counts and keeps the TTL on increments', async () => {
    const redis = connect();
    const k = key();
    expect(await redis.incr(k)).toBe(1);
    await redis.expire(k, 100);
    expect(await redis.incr(k)).toBe(2);
    expect(await redis.decr(k)).toBe(1);
    expect(await redis.ttl(k)).toBeGreaterThan(90);
    await redis.set(k, 'not a number');
    await expect(redis.incr(k)).rejects.toThrow('not an integer');
    await redis.del(k);
  });

  it('answers MGET per key and DEL by count', async () => {
    const redis = connect();
    const [a, b, missing] = [key(), key(), key()];
    await redis.set(a, '1');
    await redis.sadd(b, 'member');
    expect(await redis.mget(a, b, missing)).toEqual(['1', null, null]);
    expect(await redis.del(a, b, missing)).toBe(2);
  });

  it('rejects the wrong type', async () => {
    const redis = connect();
    const k = key();
    await redis.sadd(k, 'member');
    await expect(redis.get(k)).rejects.toThrow('WRONGTYPE');
    await expect(redis.hset(k, 'f', 'v')).rejects.toThrow('WRONGTYPE');
    await redis.del(k);
  });
});

describe('collections', () => {
  it('handles hashes and removes emptied keys', async () => {
    const redis = connect();
    const k = key();
    expect(await redis.hset(k, 'a', '1', 'b', '2')).toBe(2);
    expect(await redis.hset(k, 'a', '9')).toBe(0);
    expect(await redis.hgetall(k)).toEqual({ a: '9', b: '2' });
    expect(await redis.hlen(k)).toBe(2);
    expect(await redis.hdel(k, 'a', 'missing')).toBe(1);
    expect(await redis.hdel(k, 'b')).toBe(1);
    expect(await redis.exists(k)).toBe(0);
    expect(await redis.hgetall(k)).toEqual({});
  });

  it('handles sets', async () => {
    const redis = connect();
    const k = key();
    expect(await redis.sadd(k, 'a', 'b', 'a')).toBe(2);
    expect(await redis.scard(k)).toBe(2);
    expect((await redis.smembers(k)).sort()).toEqual(['a', 'b']);
    expect(await redis.srem(k, 'a', 'b')).toBe(2);
    expect(await redis.exists(k)).toBe(0);
  });

  it('orders sorted sets by score then member', async () => {
    const redis = connect();
    const k = key();
    expect(await redis.zadd(k, 2, 'b', 1, 'z', 1, 'a')).toBe(3);
    expect(await redis.zadd(k, 3, 'b')).toBe(0);
    expect(await redis.zrange(k, 0, -1)).toEqual(['a', 'z', 'b']);
    expect(await redis.zcard(k)).toBe(3);
    expect(await redis.zrangebyscore(k, 1, 1)).toEqual(['a', 'z']);
    expect(await redis.zrangebyscore(k, '(1', '+inf')).toEqual(['b']);
    expect(await redis.zrangebyscore(k, '-inf', '+inf', 'LIMIT', 1, 1)).toEqual(['z']);
    expect(await redis.zrangebyscore(k, 1, 3, 'WITHSCORES')).toEqual(['a', '1', 'z', '1', 'b', '3']);
    expect(await redis.zscore(k, 'b')).toBe('3');
    expect(await redis.zrem(k, 'a', 'z', 'b')).toBe(3);
    expect(await redis.exists(k)).toBe(0);
  });

  it('finds keys with SCAN', async () => {
    const redis = connect();
    const prefix = key();
    await redis.set(`${prefix}:1`, 'v');
    await redis.set(`${prefix}:2`, 'v');
    const found: string[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}:*`, 'COUNT', 100);
      cursor = next;
      found.push(...keys);
    } while (cursor !== '0');
    expect(found.sort()).toEqual([`${prefix}:1`, `${prefix}:2`]);
    await redis.del(...found);
  });
});

describe('transactions and scripts', () => {
  it('runs MULTI atomically and returns per-command results', async () => {
    const redis = connect();
    const [a, z] = [key(), key()];
    const results = await redis.multi().set(a, 'v', 'EX', 60).zadd(z, 5, 'm').exec();
    expect(results).toEqual([[null, 'OK'], [null, 1]]);
    expect(await redis.zscore(z, 'm')).toBe('5');
    await redis.del(a, z);
  });

  it('aborts EXEC after a queue-time error', async () => {
    const redis = connect();
    const k = key();
    const multi = redis.multi();
    multi.set(k, 'v');
    multi.call('NOSUCHCOMMAND');
    await expect(multi.exec()).rejects.toThrow('EXECABORT');
    expect(await redis.exists(k)).toBe(0);
  });

  it('runs the lock release script', async () => {
    const redis = connect();
    const k = key();
    const script = `
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
`;
    await redis.set(k, 'owner');
    expect(await redis.eval(script, 1, k, 'someone-else')).toBe(0);
    expect(await redis.get(k)).toBe('owner');
    expect(await redis.eval(script, 1, k, 'owner')).toBe(1);
    expect(await redis.exists(k)).toBe(0);
  });

  it('runs the get-and-delete script', async () => {
    const redis = connect();
    const k = key();
    const script = `
local v = redis.call('GET', KEYS[1])
if v then redis.call('DEL', KEYS[1]) end
return v
`;
    await redis.set(k, 'payload');
    expect(await redis.eval(script, 1, k)).toBe('payload');
    expect(await redis.eval(script, 1, k)).toBeNull();
  });
});

describe('streams', () => {
  const entry = (id: string, payload: string): [string, string[]] => [id, ['event_type', 'e', 'payload', payload]];

  it('rejects stream ids that do not increase', async () => {
    const redis = connect();
    const k = key();
    expect(await redis.xadd(k, '100-0', 'event_type', 'e', 'payload', '1')).toBe('100-0');
    await expect(redis.xadd(k, '100-0', 'event_type', 'e', 'payload', '2')).rejects.toThrow('equal or smaller');
    await expect(redis.xadd(k, '99-0', 'event_type', 'e', 'payload', '2')).rejects.toThrow('equal or smaller');
    expect(await redis.xlen(k)).toBe(1);
    await redis.del(k);
  });

  it('reads after a cursor with COUNT', async () => {
    const redis = connect();
    const k = key();
    await redis.xadd(k, '1-0', 'event_type', 'e', 'payload', 'a');
    await redis.xadd(k, '2-0', 'event_type', 'e', 'payload', 'b');
    await redis.xadd(k, '3-0', 'event_type', 'e', 'payload', 'c');
    expect(await redis.xread('COUNT', 2, 'STREAMS', k, '0')).toEqual([
      [k, [entry('1-0', 'a'), entry('2-0', 'b')]],
    ]);
    expect(await redis.xread('COUNT', 20, 'STREAMS', k, '2-0')).toEqual([[k, [entry('3-0', 'c')]]]);
    expect(await redis.xread('STREAMS', k, '3-0')).toBeNull();
    await redis.del(k);
  });

  it('times out a blocked read with null', async () => {
    const redis = connect();
    const started = Date.now();
    expect(await redis.xread('COUNT', 20, 'BLOCK', 100, 'STREAMS', key(), '0')).toBeNull();
    expect(Date.now() - started).toBeGreaterThanOrEqual(90);
  });

  it('wakes a blocked reader from another connection', async () => {
    const [reader, writer] = [connect(), connect()];
    const k = key();
    const pending = reader.xread('COUNT', 20, 'BLOCK', 5000, 'STREAMS', k, '0');
    await sleep(50);
    await writer.xadd(k, '7-0', 'event_type', 'e', 'payload', 'live');
    expect(await pending).toEqual([[k, [entry('7-0', 'live')]]]);
    await writer.del(k);
  });

  it('keeps commands behind a blocked read in order', async () => {
    const redis = connect();
    const k = key();
    const blocked = redis.xread('BLOCK', 100, 'STREAMS', k, '0');
    const after = redis.ping();
    expect(await after).toBe('PONG');
    expect(await blocked).toBeNull();
  });
});

describe('connections', () => {
  it('shares the keyspace across connections and isolates databases', async () => {
    const [a, b] = [connect(), connect()];
    const k = key();
    await a.set(k, 'shared');
    expect(await b.get(k)).toBe('shared');
    const other = connect();
    await other.select(9);
    expect(await other.get(k)).toBeNull();
    await a.del(k);
  });
});

describe.skipIf(Boolean(realUrl))('lite-stores specifics', () => {
  it('answers an error for an unknown script instead of guessing', async () => {
    const redis = connect();
    await expect(redis.eval('return 1', 0)).rejects.toThrow('does not implement this Lua script');
  });
});
