// SPDX-License-Identifier: AGPL-3.0-only
// Embedded PostgreSQL behind the Postgres wire protocol, so services connect with their usual driver.
//
// PGlite is one session in one process, so client connections are multiplexed over it. Two rules keep
// that invisible to clients:
//
// 1. A request runs whole. The extended protocol spreads one query over Parse/Bind/Describe/Execute/
//    Sync, and the unnamed statement and portal they use live in the session: if another connection's
//    messages landed in between, a query could fail or, worse, run with the wrong statement. Messages
//    are therefore buffered per connection up to the end of the request (this is what
//    @electric-sql/pglite-socket does not do: it queues message by message, which fails under
//    concurrency with "unnamed prepared statement does not exist").
// 2. A transaction owns the session. Between BEGIN and COMMIT only its connection runs. Transactions
//    therefore run one at a time, unlike on a real server, and a transaction whose owner stops talking
//    to the database (it awaits another connection, or an HTTP call back into a sibling service) would
//    stall everything: the watchdog cuts such a connection, which rolls back like a lost backend.
import { createServer, type Socket } from 'node:net';
import type { PGlite } from '@electric-sql/pglite';

/** The direct database access hosts get, for bootstrapping; everything else goes through the port. */
export interface LiteDatabase {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface PgliteServerOptions {
  /** Directory holding the database files; omitted means in-memory. */
  dataDir?: string;
  /** Defaults to loopback: the server accepts any credentials. */
  host?: string;
  /** 0 or omitted picks a free port. */
  port?: number;
  /** A transaction idle this long is cut; defaults to 30 seconds, 0 turns the watchdog off. */
  stuckTransactionMs?: number;
  /** Runs before the port opens, so no client sees a half-built schema. */
  initialize?: (db: LiteDatabase) => Promise<void>;
  onStuckTransaction?: (info: { idleMs: number; queuedRequests: number }) => void;
}

export interface PgliteServer {
  db: LiteDatabase;
  host: string;
  port: number;
  close(): Promise<void>;
}

const WATCHDOG_INTERVAL_MS = 1000;
const SSL_REQUEST = 80877103;
const GSS_REQUEST = 80877104;
const CANCEL_REQUEST = 80877102;
const PROTOCOL_V3 = 196608;

const MESSAGE_SYNC = 0x53; // S
const MESSAGE_QUERY = 0x51; // Q
const MESSAGE_FLUSH = 0x48; // H
const MESSAGE_TERMINATE = 0x58; // X
// COPY FROM STDIN data follows a finished Query and has no request boundary of its own.
const MESSAGES_COPY = new Set([0x64, 0x63, 0x66]); // d, c, f

interface Connection {
  socket: Socket;
  closed: boolean;
  /** A Flush ended the last request: the client awaits a reply mid-query and will continue it. */
  midQuery: boolean;
  lastActivity: number;
}

interface Request {
  connection: Connection;
  message: Uint8Array;
}

/** Runs requests one at a time on the single session, honouring the owner of an open transaction. */
class Multiplexer {
  private readonly queue: Request[] = [];
  private owner: Connection | null = null;
  private running = false;
  private readonly db: PGlite;

  constructor(db: PGlite) {
    this.db = db;
  }

  enqueue(request: Request): void {
    this.queue.push(request);
    void this.pump();
  }

  /** Drops what a gone connection still had queued; pump then rolls back a transaction it left open. */
  forget(connection: Connection): void {
    for (let i = this.queue.length - 1; i >= 0; i -= 1) {
      if (this.queue[i]?.connection === connection) this.queue.splice(i, 1);
    }
    void this.pump();
  }

  /** The connection holding an open transaction, when there is one. */
  transactionOwner(): Connection | null {
    return this.db.isInTransaction() ? this.owner : null;
  }

  get queued(): number {
    return this.queue.length;
  }

  private next(): Request | undefined {
    const exclusive = this.db.isInTransaction() || this.owner?.midQuery === true;
    if (!exclusive || !this.owner) return this.queue.shift();
    const index = this.queue.findIndex((request) => request.connection === this.owner);
    return index === -1 ? undefined : this.queue.splice(index, 1)[0];
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        if (this.owner?.closed) {
          if (this.db.isInTransaction()) await this.db.exec('ROLLBACK');
          this.owner = null;
        }
        const request = this.next();
        if (!request) return;
        const { connection, message } = request;
        this.owner = connection;
        try {
          await this.db.runExclusive(() =>
            this.db.execProtocolRawStream(message, {
              // The chunk is a view into WASM memory that the next query overwrites.
              onRawData: (chunk) => {
                if (!connection.closed) connection.socket.write(Buffer.from(chunk));
              },
            }),
          );
        } catch {
          connection.socket.destroy();
        }
      }
    } finally {
      this.running = false;
    }
  }
}

/** Splits a connection's bytes into whole requests. */
function attachConnection(socket: Socket, multiplexer: Multiplexer, connections: Set<Connection>): void {
  const connection: Connection = { socket, closed: false, midQuery: false, lastActivity: Date.now() };
  connections.add(connection);
  let started = false;
  let buffer: Buffer = Buffer.alloc(0);
  let requestLength = 0;

  const submit = (midQuery: boolean): void => {
    const message = buffer.subarray(0, requestLength);
    buffer = buffer.subarray(requestLength);
    requestLength = 0;
    connection.midQuery = midQuery;
    multiplexer.enqueue({ connection, message: new Uint8Array(message) });
  };

  const readStartup = (): boolean => {
    if (buffer.length < 8) return false;
    const length = buffer.readInt32BE(0);
    const code = buffer.readInt32BE(4);
    if (code === SSL_REQUEST || code === GSS_REQUEST) {
      buffer = buffer.subarray(8);
      socket.write('N');
      return true;
    }
    if (code === CANCEL_REQUEST) {
      // There is no way to interrupt the one session; the client just closes this side channel.
      socket.destroy();
      return false;
    }
    if (code !== PROTOCOL_V3) {
      socket.destroy();
      return false;
    }
    if (buffer.length < length) return false;
    started = true;
    requestLength = length;
    submit(false);
    return true;
  };

  const readMessage = (): boolean => {
    if (buffer.length < requestLength + 5) return false;
    const type = buffer[requestLength] as number;
    const end = requestLength + 1 + buffer.readInt32BE(requestLength + 1);
    if (buffer.length < end) return false;
    if (type === MESSAGE_TERMINATE) {
      // Not forwarded: on PGlite it would end the one session every connection shares.
      socket.destroy();
      return false;
    }
    requestLength = end;
    if (type === MESSAGE_FLUSH) submit(true);
    else if (type === MESSAGE_SYNC || type === MESSAGE_QUERY || MESSAGES_COPY.has(type)) submit(false);
    return true;
  };

  socket.setNoDelay(true);
  socket.on('data', (chunk) => {
    connection.lastActivity = Date.now();
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
    while (!connection.closed && (started ? readMessage() : readStartup())) {
      // Each call consumes one message or reports that more bytes are needed.
    }
  });
  socket.on('error', () => socket.destroy());
  socket.on('close', () => {
    connection.closed = true;
    connections.delete(connection);
    multiplexer.forget(connection);
  });
}

export async function startPgliteServer(options: PgliteServerOptions = {}): Promise<PgliteServer> {
  // Imported on demand: the WASM build is large and memory-redis users never need it.
  const [{ PGlite }, { uuid_ossp }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/uuid_ossp'),
  ]);
  const db = await PGlite.create({
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
    extensions: { uuid_ossp },
  });
  await options.initialize?.(db);

  const multiplexer = new Multiplexer(db);
  const connections = new Set<Connection>();
  const server = createServer((socket) => attachConnection(socket, multiplexer, connections));
  const host = options.host ?? '127.0.0.1';
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('pglite server has no TCP address');

  const stuckMs = options.stuckTransactionMs ?? 30_000;
  const watchdog =
    stuckMs > 0
      ? setInterval(() => {
          const owner = multiplexer.transactionOwner();
          if (!owner || owner.closed) return;
          const idleMs = Date.now() - owner.lastActivity;
          if (idleMs < stuckMs) return;
          options.onStuckTransaction?.({ idleMs, queuedRequests: multiplexer.queued });
          owner.socket.destroy();
        }, WATCHDOG_INTERVAL_MS)
      : undefined;
  watchdog?.unref();

  return {
    db,
    host,
    port: address.port,
    close: async () => {
      if (watchdog) clearInterval(watchdog);
      for (const connection of connections) connection.socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.close();
    },
  };
}
