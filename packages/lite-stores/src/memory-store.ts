// SPDX-License-Identifier: AGPL-3.0-only
// The in-memory keyspace behind the Redis protocol server. It implements the subset of Redis the
// platform uses with Redis semantics (checked against a real server by memory-redis.test.ts when
// LITE_STORES_REAL_REDIS_URL is set). Commands outside the subset answer an error, never a
// silently wrong result.
import { NULL_ARRAY, OK, type Reply, type ReplyError } from './resp.ts';

type StreamEntry = { id: string; fields: string[] };

type Value =
  | { type: 'string'; value: string }
  | { type: 'hash'; value: Map<string, string> }
  | { type: 'set'; value: Set<string> }
  | { type: 'zset'; value: Map<string, number> }
  | { type: 'stream'; value: StreamEntry[]; lastId: string };

type Entry = Value & { expireAt?: number };

type Keyspace = Map<string, Entry>;

type Handler = (keyspace: Keyspace, args: string[]) => Reply;

export interface StreamRead {
  count: number | undefined;
  /** Milliseconds to wait; undefined means do not block, 0 means wait forever. */
  block: number | undefined;
  streams: { key: string; afterId: string }[];
}

const err = (error: string): ReplyError => ({ error });
const SYNTAX = err('ERR syntax error');
const NOT_INTEGER = err('ERR value is not an integer or out of range');
const NOT_FLOAT = err('ERR value is not a valid float');
const BAD_MIN_MAX = err('ERR min or max is not a float');
const WRONGTYPE = err('WRONGTYPE Operation against a key holding the wrong kind of value');
const BAD_STREAM_ID = err('ERR Invalid stream ID specified as stream command argument');
const STREAM_ID_TOO_SMALL = err(
  'ERR The ID specified in XADD is equal or smaller than the target stream top item',
);

function parseInteger(raw: string): number | null {
  if (!/^-?\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function parseScore(raw: string): number | null {
  const lower = raw.toLowerCase();
  if (lower === 'inf' || lower === '+inf') return Number.POSITIVE_INFINITY;
  if (lower === '-inf') return Number.NEGATIVE_INFINITY;
  const value = Number(raw);
  return raw.trim() === '' || Number.isNaN(value) ? null : value;
}

function formatScore(score: number): string {
  if (score === Number.POSITIVE_INFINITY) return 'inf';
  if (score === Number.NEGATIVE_INFINITY) return '-inf';
  return String(score);
}

function globToRegExp(pattern: string): RegExp {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i] as string;
    if (char === '*') source += '[\\s\\S]*';
    else if (char === '?') source += '[\\s\\S]';
    else if (char === '\\' && i + 1 < pattern.length) {
      i += 1;
      source += (pattern[i] as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    } else if (char === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end === -1) {
        source += '\\[';
      } else {
        const body = pattern.slice(i + 1, end).replace(/^\^/, '!').replace(/\\/g, '\\\\');
        source += `[${body.startsWith('!') ? `^${body.slice(1)}` : body}]`;
        i = end;
      }
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

function parseStreamId(raw: string): [number, number] | null {
  const match = /^(\d+)(?:-(\d+))?$/.exec(raw);
  if (!match) return null;
  return [Number(match[1]), match[2] === undefined ? 0 : Number(match[2])];
}

function compareStreamIds(a: string, b: string): number {
  const [aMs, aSeq] = parseStreamId(a) as [number, number];
  const [bMs, bSeq] = parseStreamId(b) as [number, number];
  return aMs - bMs || aSeq - bSeq;
}

function entryReply(entry: StreamEntry): Reply {
  return [entry.id, entry.fields];
}

// The only Lua the platform runs. Scripts are matched by normalized text instead of being
// interpreted; an unknown script is an error, so a new one is added here deliberately.
const normalizeScript = (script: string): string =>
  script.replace(/"/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
const COMPARE_AND_DELETE = normalizeScript(
  `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
);
const GET_AND_DELETE = normalizeScript(
  `local v = redis.call('GET', KEYS[1]) if v then redis.call('DEL', KEYS[1]) end return v`,
);

export class MemoryStore {
  private readonly keyspaces = new Map<number, Keyspace>();
  private readonly sweeper: ReturnType<typeof setInterval>;

  constructor() {
    // Reads expire lazily; the sweep bounds the memory of keys nobody reads again.
    this.sweeper = setInterval(() => this.sweep(), 1000);
    this.sweeper.unref();
  }

  close(): void {
    clearInterval(this.sweeper);
  }

  /** Whether the command exists with an acceptable argument count: MULTI rejects at queue time. */
  validate(name: string, args: string[]): ReplyError | null {
    const spec = COMMANDS[name];
    if (!spec) return err(`ERR unknown command '${name.toLowerCase()}'`);
    if (args.length < spec.minArgs) {
      return err(`ERR wrong number of arguments for '${name.toLowerCase()}' command`);
    }
    return null;
  }

  execute(db: number, name: string, args: string[]): Reply {
    const invalid = this.validate(name, args);
    if (invalid) return invalid;
    return (COMMANDS[name] as CommandSpec).handler(this.keyspace(db), args);
  }

  /** Parses XREAD arguments, pinning `$` to the current top of each stream. */
  parseStreamRead(db: number, args: string[]): StreamRead | ReplyError {
    let count: number | undefined;
    let block: number | undefined;
    let i = 0;
    for (; i < args.length; i += 1) {
      const option = (args[i] as string).toUpperCase();
      if (option === 'STREAMS') break;
      const value = args[i + 1];
      if ((option !== 'COUNT' && option !== 'BLOCK') || value === undefined) return SYNTAX;
      const parsed = parseInteger(value);
      if (parsed === null) return NOT_INTEGER;
      if (option === 'COUNT') count = parsed;
      else block = parsed;
      i += 1;
    }
    const rest = args.slice(i + 1);
    if (i >= args.length || rest.length === 0 || rest.length % 2 !== 0) {
      return err(
        "ERR Unbalanced 'xread' list of streams: for each stream key an ID or '$' must be specified.",
      );
    }
    const half = rest.length / 2;
    const keyspace = this.keyspace(db);
    const streams: StreamRead['streams'] = [];
    for (let k = 0; k < half; k += 1) {
      const key = rest[k] as string;
      const id = rest[half + k] as string;
      const entry = live(keyspace, key);
      if (entry && entry.type !== 'stream') return WRONGTYPE;
      if (id === '$') streams.push({ key, afterId: entry?.type === 'stream' ? entry.lastId : '0-0' });
      else if (parseStreamId(id)) streams.push({ key, afterId: id });
      else return BAD_STREAM_ID;
    }
    return { count, block, streams };
  }

  /** The entries after each cursor, or null when no stream has any. */
  readStreams(db: number, read: StreamRead): Reply[] | null {
    const keyspace = this.keyspace(db);
    const result: Reply[] = [];
    for (const { key, afterId } of read.streams) {
      const entry = live(keyspace, key);
      if (entry?.type !== 'stream') continue;
      let entries = entry.value.filter((candidate) => compareStreamIds(candidate.id, afterId) > 0);
      if (read.count !== undefined && read.count > 0) entries = entries.slice(0, read.count);
      if (entries.length > 0) result.push([key, entries.map(entryReply)]);
    }
    return result.length > 0 ? result : null;
  }

  private keyspace(db: number): Keyspace {
    let keyspace = this.keyspaces.get(db);
    if (!keyspace) {
      keyspace = new Map();
      this.keyspaces.set(db, keyspace);
    }
    return keyspace;
  }

  private sweep(): void {
    const now = Date.now();
    for (const keyspace of this.keyspaces.values()) {
      for (const [key, entry] of keyspace) {
        if (entry.expireAt !== undefined && entry.expireAt <= now) keyspace.delete(key);
      }
    }
  }
}

function live(keyspace: Keyspace, key: string): Entry | undefined {
  const entry = keyspace.get(key);
  if (entry?.expireAt !== undefined && entry.expireAt <= Date.now()) {
    keyspace.delete(key);
    return undefined;
  }
  return entry;
}

/** The value at a key, narrowed to one type; WRONGTYPE when it holds another. */
function typed<T extends Value['type']>(
  keyspace: Keyspace,
  key: string,
  type: T,
): Extract<Entry, { type: T }> | undefined | ReplyError {
  const entry = live(keyspace, key);
  if (!entry) return undefined;
  return entry.type === type ? (entry as Extract<Entry, { type: T }>) : WRONGTYPE;
}

const isError = (value: unknown): value is ReplyError =>
  typeof value === 'object' && value !== null && 'error' in value;

function setExpiry(keyspace: Keyspace, key: string, entry: Entry, expireAt: number): void {
  if (expireAt <= Date.now()) keyspace.delete(key);
  else entry.expireAt = expireAt;
}

function incrementBy(keyspace: Keyspace, key: string, delta: number): Reply {
  const entry = typed(keyspace, key, 'string');
  if (isError(entry)) return entry;
  const current = entry ? parseInteger(entry.value) : 0;
  if (current === null) return NOT_INTEGER;
  const next = current + delta;
  if (!Number.isSafeInteger(next)) return err('ERR increment or decrement would overflow');
  if (entry) entry.value = String(next);
  else keyspace.set(key, { type: 'string', value: String(next) });
  return next;
}

function commandSet(keyspace: Keyspace, args: string[]): Reply {
  const [key, value] = args as [string, string];
  let expireAt: number | undefined;
  let onlyIfMissing = false;
  let onlyIfPresent = false;
  let keepTtl = false;
  let returnOld = false;
  for (let i = 2; i < args.length; i += 1) {
    const option = (args[i] as string).toUpperCase();
    if (option === 'NX') onlyIfMissing = true;
    else if (option === 'XX') onlyIfPresent = true;
    else if (option === 'KEEPTTL') keepTtl = true;
    else if (option === 'GET') returnOld = true;
    else if (option === 'EX' || option === 'PX' || option === 'EXAT' || option === 'PXAT') {
      const amount = args[i + 1] === undefined ? null : parseInteger(args[i + 1] as string);
      if (args[i + 1] === undefined) return SYNTAX;
      if (amount === null) return NOT_INTEGER;
      if (amount <= 0) return err("ERR invalid expire time in 'set' command");
      expireAt =
        option === 'EX' ? Date.now() + amount * 1000
        : option === 'PX' ? Date.now() + amount
        : option === 'EXAT' ? amount * 1000
        : amount;
      i += 1;
    } else return SYNTAX;
  }
  if ((onlyIfMissing && onlyIfPresent) || (keepTtl && expireAt !== undefined)) return SYNTAX;
  const existing = live(keyspace, key);
  if (returnOld && existing && existing.type !== 'string') return WRONGTYPE;
  const old = existing?.type === 'string' ? existing.value : null;
  if ((onlyIfMissing && existing) || (onlyIfPresent && !existing)) return returnOld ? old : null;
  const next: Entry = { type: 'string', value };
  if (keepTtl && existing?.expireAt !== undefined) next.expireAt = existing.expireAt;
  if (expireAt !== undefined) next.expireAt = expireAt;
  keyspace.set(key, next);
  return returnOld ? old : OK;
}

function commandExpire(keyspace: Keyspace, args: string[], unitMs: number): Reply {
  const [key, raw] = args as [string, string];
  const amount = parseInteger(raw);
  if (amount === null) return NOT_INTEGER;
  const entry = live(keyspace, key);
  if (!entry) return 0;
  setExpiry(keyspace, key, entry, Date.now() + amount * unitMs);
  return 1;
}

function commandTtl(keyspace: Keyspace, key: string, unitMs: number): Reply {
  const entry = live(keyspace, key);
  if (!entry) return -2;
  if (entry.expireAt === undefined) return -1;
  return Math.round((entry.expireAt - Date.now()) / unitMs);
}

function parseScoreBound(raw: string): { value: number; exclusive: boolean } | null {
  const exclusive = raw.startsWith('(');
  const value = parseScore(exclusive ? raw.slice(1) : raw);
  return value === null ? null : { value, exclusive };
}

function sortedMembers(zset: Map<string, number>): [string, number][] {
  return [...zset].sort(([aMember, aScore], [bMember, bScore]) =>
    aScore - bScore || (aMember < bMember ? -1 : aMember > bMember ? 1 : 0),
  );
}

function membersByScore(
  zset: Map<string, number>,
  minRaw: string,
  maxRaw: string,
): [string, number][] | ReplyError {
  const min = parseScoreBound(minRaw);
  const max = parseScoreBound(maxRaw);
  if (!min || !max) return BAD_MIN_MAX;
  return sortedMembers(zset).filter(
    ([, score]) =>
      (min.exclusive ? score > min.value : score >= min.value) &&
      (max.exclusive ? score < max.value : score <= max.value),
  );
}

function withScoresReply(members: [string, number][], withScores: boolean): Reply {
  return members.flatMap(([member, score]) => (withScores ? [member, formatScore(score)] : [member]));
}

function commandZadd(keyspace: Keyspace, args: string[]): Reply {
  const key = args[0] as string;
  let i = 1;
  let onlyNew = false;
  let onlyExisting = false;
  let countChanged = false;
  for (; i < args.length; i += 1) {
    const option = (args[i] as string).toUpperCase();
    if (option === 'NX') onlyNew = true;
    else if (option === 'XX') onlyExisting = true;
    else if (option === 'CH') countChanged = true;
    else break;
  }
  const pairs = args.slice(i);
  if (pairs.length === 0 || pairs.length % 2 !== 0 || (onlyNew && onlyExisting)) return SYNTAX;
  const scores: [string, number][] = [];
  for (let p = 0; p < pairs.length; p += 2) {
    const score = parseScore(pairs[p] as string);
    if (score === null) return NOT_FLOAT;
    scores.push([pairs[p + 1] as string, score]);
  }
  const entry = typed(keyspace, key, 'zset');
  if (isError(entry)) return entry;
  const target = entry ?? { type: 'zset' as const, value: new Map<string, number>() };
  let added = 0;
  let changed = 0;
  for (const [member, score] of scores) {
    const previous = target.value.get(member);
    if (previous === undefined) {
      if (onlyExisting) continue;
      target.value.set(member, score);
      added += 1;
    } else if (!onlyNew && previous !== score) {
      target.value.set(member, score);
      changed += 1;
    }
  }
  if (!entry && target.value.size > 0) keyspace.set(key, target);
  return countChanged ? added + changed : added;
}

function commandZrangeByScore(keyspace: Keyspace, args: string[]): Reply {
  const [key, min, max] = args as [string, string, string];
  let withScores = false;
  let offset = 0;
  let limit = Number.POSITIVE_INFINITY;
  for (let i = 3; i < args.length; i += 1) {
    const option = (args[i] as string).toUpperCase();
    if (option === 'WITHSCORES') withScores = true;
    else if (option === 'LIMIT') {
      const parsedOffset = args[i + 1] === undefined ? null : parseInteger(args[i + 1] as string);
      const parsedCount = args[i + 2] === undefined ? null : parseInteger(args[i + 2] as string);
      if (args[i + 1] === undefined || args[i + 2] === undefined) return SYNTAX;
      if (parsedOffset === null || parsedCount === null) return NOT_INTEGER;
      offset = parsedOffset;
      limit = parsedCount < 0 ? Number.POSITIVE_INFINITY : parsedCount;
      i += 2;
    } else return SYNTAX;
  }
  const entry = typed(keyspace, key, 'zset');
  if (isError(entry)) return entry;
  const members = membersByScore(entry?.value ?? new Map<string, number>(), min, max);
  if (isError(members)) return members;
  if (offset < 0) return [];
  return withScoresReply(members.slice(offset, offset + limit), withScores);
}

function commandXadd(keyspace: Keyspace, args: string[]): Reply {
  const [key, rawId] = args as [string, string];
  const fields = args.slice(2);
  if (fields.length === 0 || fields.length % 2 !== 0) {
    return err("ERR wrong number of arguments for 'xadd' command");
  }
  const entry = typed(keyspace, key, 'stream');
  if (isError(entry)) return entry;
  const lastId = entry?.lastId ?? '0-0';
  const [lastMs, lastSeq] = parseStreamId(lastId) as [number, number];
  let id: string;
  if (rawId === '*') {
    const now = Date.now();
    id = now > lastMs ? `${now}-0` : `${lastMs}-${lastSeq + 1}`;
  } else if (rawId.endsWith('-*')) {
    const ms = Number(rawId.slice(0, -2));
    if (!Number.isSafeInteger(ms)) return BAD_STREAM_ID;
    if (ms < lastMs) return STREAM_ID_TOO_SMALL;
    id = `${ms}-${ms === lastMs ? lastSeq + 1 : 0}`;
  } else {
    const parsed = parseStreamId(rawId);
    if (!parsed) return BAD_STREAM_ID;
    id = `${parsed[0]}-${parsed[1]}`;
    if (id === '0-0') return err('ERR The ID specified in XADD must be greater than 0-0');
    if (compareStreamIds(id, lastId) <= 0) return STREAM_ID_TOO_SMALL;
  }
  const target = entry ?? { type: 'stream' as const, value: [] as StreamEntry[], lastId };
  target.value.push({ id, fields });
  target.lastId = id;
  if (!entry) keyspace.set(key, target);
  return id;
}

function commandScan(keyspace: Keyspace, args: string[]): Reply {
  let pattern: RegExp | undefined;
  let type: string | undefined;
  if (parseInteger(args[0] as string) === null) return err('ERR invalid cursor');
  for (let i = 1; i < args.length; i += 2) {
    const option = (args[i] as string).toUpperCase();
    const value = args[i + 1];
    if (value === undefined) return SYNTAX;
    if (option === 'MATCH') pattern = globToRegExp(value);
    else if (option === 'TYPE') type = value.toLowerCase();
    else if (option === 'COUNT') {
      if (parseInteger(value) === null) return NOT_INTEGER;
    } else return SYNTAX;
  }
  // COUNT is only a hint in Redis: one pass over the whole keyspace is a valid full iteration.
  const keys = [...keyspace.keys()].filter((key) => {
    const entry = live(keyspace, key);
    return entry && (!pattern || pattern.test(key)) && (!type || entry.type === type);
  });
  return ['0', keys];
}

function commandEval(keyspace: Keyspace, args: string[]): Reply {
  const [script, rawKeyCount] = args as [string, string];
  const keyCount = parseInteger(rawKeyCount);
  if (keyCount === null) return NOT_INTEGER;
  if (keyCount < 0) return err("ERR Number of keys can't be negative");
  if (keyCount > args.length - 2) return err("ERR Number of keys can't be greater than number of args");
  const key = args[2] as string;
  const normalized = normalizeScript(script);
  if (normalized !== COMPARE_AND_DELETE && normalized !== GET_AND_DELETE) {
    return err('ERR @ainobi/lite-stores does not implement this Lua script; add it to memory-store.ts');
  }
  const entry = typed(keyspace, key, 'string');
  if (isError(entry)) return entry;
  if (normalized === GET_AND_DELETE) {
    if (entry) keyspace.delete(key);
    return entry?.value ?? null;
  }
  if (entry?.value !== args[3]) return 0;
  keyspace.delete(key);
  return 1;
}

interface CommandSpec {
  minArgs: number;
  handler: Handler;
}

const command = (minArgs: number, handler: Handler): CommandSpec => ({ minArgs, handler });

const COMMANDS: Record<string, CommandSpec> = {
  // connection-free
  PING: command(0, (_k, args) => (args[0] === undefined ? { simple: 'PONG' } : args[0])),
  ECHO: command(1, (_k, args) => args[0] as string),
  DBSIZE: command(0, (k) => [...k.keys()].filter((key) => live(k, key)).length),
  FLUSHDB: command(0, (k) => {
    k.clear();
    return OK;
  }),

  // keys
  DEL: command(1, (k, args) => args.filter((key) => live(k, key) && k.delete(key)).length),
  UNLINK: command(1, (k, args) => args.filter((key) => live(k, key) && k.delete(key)).length),
  EXISTS: command(1, (k, args) => args.filter((key) => live(k, key)).length),
  EXPIRE: command(2, (k, args) => commandExpire(k, args, 1000)),
  PEXPIRE: command(2, (k, args) => commandExpire(k, args, 1)),
  TTL: command(1, (k, args) => commandTtl(k, args[0] as string, 1000)),
  PTTL: command(1, (k, args) => commandTtl(k, args[0] as string, 1)),
  PERSIST: command(1, (k, args) => {
    const entry = live(k, args[0] as string);
    if (entry?.expireAt === undefined) return 0;
    delete entry.expireAt;
    return 1;
  }),
  TYPE: command(1, (k, args) => ({ simple: live(k, args[0] as string)?.type ?? 'none' })),
  KEYS: command(1, (k, args) => {
    const pattern = globToRegExp(args[0] as string);
    return [...k.keys()].filter((key) => live(k, key) && pattern.test(key));
  }),
  SCAN: command(1, commandScan),

  // strings
  GET: command(1, (k, args) => {
    const entry = typed(k, args[0] as string, 'string');
    return isError(entry) ? entry : (entry?.value ?? null);
  }),
  SET: command(2, commandSet),
  SETEX: command(3, (k, args) => {
    const seconds = parseInteger(args[1] as string);
    if (seconds === null) return NOT_INTEGER;
    if (seconds <= 0) return err("ERR invalid expire time in 'setex' command");
    k.set(args[0] as string, {
      type: 'string',
      value: args[2] as string,
      expireAt: Date.now() + seconds * 1000,
    });
    return OK;
  }),
  PSETEX: command(3, (k, args) => {
    const ms = parseInteger(args[1] as string);
    if (ms === null) return NOT_INTEGER;
    if (ms <= 0) return err("ERR invalid expire time in 'psetex' command");
    k.set(args[0] as string, { type: 'string', value: args[2] as string, expireAt: Date.now() + ms });
    return OK;
  }),
  SETNX: command(2, (k, args) => {
    if (live(k, args[0] as string)) return 0;
    k.set(args[0] as string, { type: 'string', value: args[1] as string });
    return 1;
  }),
  GETDEL: command(1, (k, args) => {
    const entry = typed(k, args[0] as string, 'string');
    if (isError(entry)) return entry;
    if (entry) k.delete(args[0] as string);
    return entry?.value ?? null;
  }),
  MGET: command(1, (k, args) =>
    args.map((key) => {
      const entry = live(k, key);
      return entry?.type === 'string' ? entry.value : null;
    }),
  ),
  MSET: command(2, (k, args) => {
    if (args.length % 2 !== 0) return err("ERR wrong number of arguments for 'mset' command");
    for (let i = 0; i < args.length; i += 2) {
      k.set(args[i] as string, { type: 'string', value: args[i + 1] as string });
    }
    return OK;
  }),
  INCR: command(1, (k, args) => incrementBy(k, args[0] as string, 1)),
  DECR: command(1, (k, args) => incrementBy(k, args[0] as string, -1)),
  INCRBY: command(2, (k, args) => {
    const delta = parseInteger(args[1] as string);
    return delta === null ? NOT_INTEGER : incrementBy(k, args[0] as string, delta);
  }),
  DECRBY: command(2, (k, args) => {
    const delta = parseInteger(args[1] as string);
    return delta === null ? NOT_INTEGER : incrementBy(k, args[0] as string, -delta);
  }),

  // hashes
  HSET: command(3, (k, args) => {
    const key = args[0] as string;
    const pairs = args.slice(1);
    if (pairs.length % 2 !== 0) return err("ERR wrong number of arguments for 'hset' command");
    const entry = typed(k, key, 'hash');
    if (isError(entry)) return entry;
    const target = entry ?? { type: 'hash' as const, value: new Map<string, string>() };
    let added = 0;
    for (let i = 0; i < pairs.length; i += 2) {
      if (!target.value.has(pairs[i] as string)) added += 1;
      target.value.set(pairs[i] as string, pairs[i + 1] as string);
    }
    if (!entry) k.set(key, target);
    return added;
  }),
  HGET: command(2, (k, args) => {
    const entry = typed(k, args[0] as string, 'hash');
    return isError(entry) ? entry : (entry?.value.get(args[1] as string) ?? null);
  }),
  HMGET: command(2, (k, args) => {
    const entry = typed(k, args[0] as string, 'hash');
    if (isError(entry)) return entry;
    return args.slice(1).map((field) => entry?.value.get(field) ?? null);
  }),
  HGETALL: command(1, (k, args) => {
    const entry = typed(k, args[0] as string, 'hash');
    return isError(entry) ? entry : [...(entry?.value ?? [])].flat();
  }),
  HKEYS: command(1, (k, args) => {
    const entry = typed(k, args[0] as string, 'hash');
    return isError(entry) ? entry : [...(entry?.value.keys() ?? [])];
  }),
  HLEN: command(1, (k, args) => {
    const entry = typed(k, args[0] as string, 'hash');
    return isError(entry) ? entry : (entry?.value.size ?? 0);
  }),
  HEXISTS: command(2, (k, args) => {
    const entry = typed(k, args[0] as string, 'hash');
    return isError(entry) ? entry : entry?.value.has(args[1] as string) ? 1 : 0;
  }),
  HDEL: command(2, (k, args) => {
    const key = args[0] as string;
    const entry = typed(k, key, 'hash');
    if (isError(entry)) return entry;
    if (!entry) return 0;
    const removed = args.slice(1).filter((field) => entry.value.delete(field)).length;
    if (entry.value.size === 0) k.delete(key);
    return removed;
  }),
  HINCRBY: command(3, (k, args) => {
    const [key, field, raw] = args as [string, string, string];
    const delta = parseInteger(raw);
    if (delta === null) return NOT_INTEGER;
    const entry = typed(k, key, 'hash');
    if (isError(entry)) return entry;
    const target = entry ?? { type: 'hash' as const, value: new Map<string, string>() };
    const current = parseInteger(target.value.get(field) ?? '0');
    if (current === null) return err('ERR hash value is not an integer');
    target.value.set(field, String(current + delta));
    if (!entry) k.set(key, target);
    return current + delta;
  }),

  // sets
  SADD: command(2, (k, args) => {
    const key = args[0] as string;
    const entry = typed(k, key, 'set');
    if (isError(entry)) return entry;
    const target = entry ?? { type: 'set' as const, value: new Set<string>() };
    const before = target.value.size;
    for (const member of args.slice(1)) target.value.add(member);
    if (!entry) k.set(key, target);
    return target.value.size - before;
  }),
  SREM: command(2, (k, args) => {
    const key = args[0] as string;
    const entry = typed(k, key, 'set');
    if (isError(entry)) return entry;
    if (!entry) return 0;
    const removed = args.slice(1).filter((member) => entry.value.delete(member)).length;
    if (entry.value.size === 0) k.delete(key);
    return removed;
  }),
  SMEMBERS: command(1, (k, args) => {
    const entry = typed(k, args[0] as string, 'set');
    return isError(entry) ? entry : [...(entry?.value ?? [])];
  }),
  SCARD: command(1, (k, args) => {
    const entry = typed(k, args[0] as string, 'set');
    return isError(entry) ? entry : (entry?.value.size ?? 0);
  }),
  SISMEMBER: command(2, (k, args) => {
    const entry = typed(k, args[0] as string, 'set');
    return isError(entry) ? entry : entry?.value.has(args[1] as string) ? 1 : 0;
  }),

  // sorted sets
  ZADD: command(3, commandZadd),
  ZREM: command(2, (k, args) => {
    const key = args[0] as string;
    const entry = typed(k, key, 'zset');
    if (isError(entry)) return entry;
    if (!entry) return 0;
    const removed = args.slice(1).filter((member) => entry.value.delete(member)).length;
    if (entry.value.size === 0) k.delete(key);
    return removed;
  }),
  ZCARD: command(1, (k, args) => {
    const entry = typed(k, args[0] as string, 'zset');
    return isError(entry) ? entry : (entry?.value.size ?? 0);
  }),
  ZSCORE: command(2, (k, args) => {
    const entry = typed(k, args[0] as string, 'zset');
    if (isError(entry)) return entry;
    const score = entry?.value.get(args[1] as string);
    return score === undefined ? null : formatScore(score);
  }),
  ZRANGE: command(3, (k, args) => {
    const [key, rawStart, rawStop, option] = args as [string, string, string, string | undefined];
    if (option !== undefined && option.toUpperCase() !== 'WITHSCORES') return SYNTAX;
    const start = parseInteger(rawStart);
    const stop = parseInteger(rawStop);
    if (start === null || stop === null) return NOT_INTEGER;
    const entry = typed(k, key, 'zset');
    if (isError(entry)) return entry;
    const members = sortedMembers(entry?.value ?? new Map<string, number>());
    const from = start < 0 ? Math.max(members.length + start, 0) : start;
    const to = stop < 0 ? members.length + stop : stop;
    return withScoresReply(members.slice(from, to + 1), option !== undefined);
  }),
  ZRANGEBYSCORE: command(3, commandZrangeByScore),
  ZREMRANGEBYSCORE: command(3, (k, args) => {
    const key = args[0] as string;
    const entry = typed(k, key, 'zset');
    if (isError(entry)) return entry;
    const members = membersByScore(entry?.value ?? new Map<string, number>(), args[1] as string, args[2] as string);
    if (isError(members)) return members;
    if (!entry) return 0;
    for (const [member] of members) entry.value.delete(member);
    if (entry.value.size === 0) k.delete(key);
    return members.length;
  }),

  // streams
  XADD: command(4, commandXadd),
  XLEN: command(1, (k, args) => {
    const entry = typed(k, args[0] as string, 'stream');
    return isError(entry) ? entry : (entry?.value.length ?? 0);
  }),
  XRANGE: command(3, (k, args) => {
    const [key, start, end] = args as [string, string, string];
    const entry = typed(k, key, 'stream');
    if (isError(entry)) return entry;
    if ((start !== '-' && !parseStreamId(start)) || (end !== '+' && !parseStreamId(end))) return BAD_STREAM_ID;
    return (entry?.value ?? [])
      .filter(
        (candidate) =>
          (start === '-' || compareStreamIds(candidate.id, start) >= 0) &&
          (end === '+' || compareStreamIds(candidate.id, end) <= 0),
      )
      .map(entryReply);
  }),

  // scripting
  EVAL: command(2, commandEval),
};

export { NULL_ARRAY };
