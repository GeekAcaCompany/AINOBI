// SPDX-License-Identifier: AGPL-3.0-only
// A TCP server speaking the Redis protocol over MemoryStore, so services keep using their Redis
// client unchanged and share one keyspace across processes. Data lives only as long as the process.
import { createServer, type Server, type Socket } from 'node:net';
import { MemoryStore, type StreamRead } from './memory-store.ts';
import {
  encodeReply,
  NULL_ARRAY,
  OK,
  ProtocolError,
  type Reply,
  RespParser,
} from './resp.ts';

export interface MemoryRedisOptions {
  /** Defaults to loopback: the server has no authentication. */
  host?: string;
  /** 0 picks a free port. */
  port?: number;
}

export interface MemoryRedisServer {
  host: string;
  port: number;
  close(): Promise<void>;
}

const DATABASE_COUNT = 16;

/** Read by the Redis client's ready check, which waits on `loading`. */
const INFO_REPLY = 'redis_version:7.2.0\r\nredis_mode:standalone\r\nloading:0\r\nrole:master\r\n';

interface Waiter {
  connection: Connection;
  read: StreamRead;
  timer: ReturnType<typeof setTimeout> | undefined;
}

class Connection {
  db = 0;
  private transaction: { queued: [string, string[]][]; failed: boolean } | null = null;
  private readonly parser = new RespParser();
  private readonly pending: string[][] = [];
  private waiter: Waiter | null = null;
  private readonly socket: Socket;
  private readonly server: Hub;

  constructor(socket: Socket, server: Hub) {
    this.socket = socket;
    this.server = server;
    socket.setNoDelay(true);
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      this.clearWaiter();
      server.connections.delete(this);
    });
  }

  destroy(): void {
    this.socket.destroy();
  }

  /** Answers a blocked XREAD (null on timeout) and resumes the commands queued behind it. */
  finishWait(reply: Reply): void {
    this.clearWaiter();
    this.write(reply);
    this.drain();
  }

  private clearWaiter(): void {
    if (!this.waiter) return;
    if (this.waiter.timer) clearTimeout(this.waiter.timer);
    this.server.waiters.delete(this.waiter);
    this.waiter = null;
  }

  private onData(chunk: Buffer): void {
    try {
      this.pending.push(...this.parser.feed(chunk));
    } catch (error) {
      if (!(error instanceof ProtocolError)) throw error;
      this.socket.end(encodeReply({ error: `ERR Protocol error: ${error.message}` }));
      return;
    }
    this.drain();
  }

  // A blocked connection answers in order, so later commands wait behind the XREAD like on Redis.
  private drain(): void {
    while (!this.waiter && this.pending.length > 0) {
      const [name, ...args] = this.pending.shift() as [string, ...string[]];
      this.handle(name.toUpperCase(), args);
    }
  }

  private write(reply: Reply): void {
    if (!this.socket.destroyed) this.socket.write(encodeReply(reply));
  }

  private handle(name: string, args: string[]): void {
    if (this.transaction && name !== 'EXEC' && name !== 'DISCARD' && name !== 'MULTI') {
      const invalid = this.server.store.validate(name, args);
      if (invalid) {
        this.transaction.failed = true;
        this.write(invalid);
      } else {
        this.transaction.queued.push([name, args]);
        this.write({ simple: 'QUEUED' });
      }
      return;
    }
    switch (name) {
      case 'AUTH':
      case 'CLIENT':
      case 'WATCH':
      case 'UNWATCH':
        // No credentials exist on a loopback development server; ioredis sends CLIENT SETINFO.
        this.write(OK);
        return;
      case 'HELLO':
        this.write({ error: 'ERR unknown command \'hello\'' });
        return;
      case 'COMMAND':
        this.write([]);
        return;
      case 'INFO':
        this.write(INFO_REPLY);
        return;
      case 'QUIT':
        this.socket.end(encodeReply(OK));
        return;
      case 'SELECT': {
        const db = Number(args[0]);
        if (!Number.isInteger(db)) this.write({ error: 'ERR invalid DB index' });
        else if (db < 0 || db >= DATABASE_COUNT) this.write({ error: 'ERR DB index is out of range' });
        else {
          this.db = db;
          this.write(OK);
        }
        return;
      }
      case 'MULTI':
        if (this.transaction) {
          this.write({ error: 'ERR MULTI calls can not be nested' });
        } else {
          this.transaction = { queued: [], failed: false };
          this.write(OK);
        }
        return;
      case 'DISCARD':
        if (this.transaction) {
          this.transaction = null;
          this.write(OK);
        } else {
          this.write({ error: 'ERR DISCARD without MULTI' });
        }
        return;
      case 'EXEC':
        this.exec();
        return;
      case 'XREAD':
        this.xread(args);
        return;
      default:
        this.write(this.server.run(this.db, name, args));
    }
  }

  private exec(): void {
    const transaction = this.transaction;
    this.transaction = null;
    if (!transaction) {
      this.write({ error: 'ERR EXEC without MULTI' });
    } else if (transaction.failed) {
      this.write({ error: 'EXECABORT Transaction discarded because of previous errors.' });
    } else {
      this.write(transaction.queued.map(([name, args]) => this.server.run(this.db, name, args)));
    }
  }

  private xread(args: string[]): void {
    const read = this.server.store.parseStreamRead(this.db, args);
    if ('error' in read) {
      this.write(read);
      return;
    }
    const entries = this.server.store.readStreams(this.db, read);
    if (entries) {
      this.write(entries);
      return;
    }
    if (read.block === undefined) {
      this.write(NULL_ARRAY);
      return;
    }
    const waiter: Waiter = {
      connection: this,
      read,
      timer:
        read.block === 0 ? undefined : setTimeout(() => this.finishWait(NULL_ARRAY), read.block),
    };
    this.waiter = waiter;
    this.server.waiters.add(waiter);
  }
}

/** What connections share: the store, the open connections, and the blocked stream readers. */
class Hub {
  readonly store = new MemoryStore();
  readonly connections = new Set<Connection>();
  readonly waiters = new Set<Waiter>();

  run(db: number, name: string, args: string[]): Reply {
    const reply = this.store.execute(db, name, args);
    if (name === 'XADD' && typeof reply === 'string') this.wakeReaders(db, args[0] as string);
    return reply;
  }

  private wakeReaders(db: number, key: string): void {
    for (const waiter of this.waiters) {
      if (waiter.connection.db !== db || !waiter.read.streams.some((s) => s.key === key)) continue;
      const entries = this.store.readStreams(db, waiter.read);
      if (entries) waiter.connection.finishWait(entries);
    }
  }
}

export async function startMemoryRedis(options: MemoryRedisOptions = {}): Promise<MemoryRedisServer> {
  const host = options.host ?? '127.0.0.1';
  const hub = new Hub();
  const server: Server = createServer((socket) => {
    hub.connections.add(new Connection(socket, hub));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('memory redis has no TCP address');
  return {
    host,
    port: address.port,
    close: () =>
      new Promise((resolve) => {
        for (const connection of hub.connections) connection.destroy();
        hub.store.close();
        server.close(() => resolve());
      }),
  };
}
