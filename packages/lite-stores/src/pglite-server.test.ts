// SPDX-License-Identifier: AGPL-3.0-only
import { connect as tcpConnect } from 'node:net';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPgliteServer, type PgliteServer } from './pglite-server.ts';

let server: PgliteServer;
const stuck: { idleMs: number }[] = [];

const connect = async (): Promise<pg.Client> => {
  const client = new pg.Client({
    host: server.host,
    port: server.port,
    user: 'postgres',
    password: 'unused',
    database: 'postgres',
  });
  // A connection cut by the watchdog reports through this event; unhandled it would crash the run.
  client.on('error', () => {});
  await client.connect();
  return client;
};

beforeAll(async () => {
  server = await startPgliteServer({
    stuckTransactionMs: 1500,
    initialize: async (db) => {
      await db.exec(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; CREATE TABLE seeded (v int);`);
    },
    onStuckTransaction: (info) => stuck.push(info),
  });
}, 60_000);

afterAll(async () => {
  await server?.close();
});

describe('pglite server', () => {
  it('runs initialize before accepting clients and offers uuid-ossp', async () => {
    const client = await connect();
    const { rows } = await client.query(
      `SELECT to_regclass('public.seeded') IS NOT NULL AS seeded, uuid_generate_v4() IS NOT NULL AS uuid`,
    );
    expect(rows[0]).toEqual({ seeded: true, uuid: true });
    await client.end();
  });

  it('hides uncommitted writes from other connections', async () => {
    const [writer, reader] = [await connect(), await connect()];
    await writer.query('CREATE TABLE isolation_probe (v int)');
    await writer.query('BEGIN');
    await writer.query('INSERT INTO isolation_probe VALUES (1)');
    const read = reader.query('SELECT count(*)::int AS n FROM isolation_probe');
    await new Promise((resolve) => setTimeout(resolve, 100));
    await writer.query('ROLLBACK');
    expect((await read).rows[0].n).toBe(0);
    await Promise.all([writer.end(), reader.end()]);
  });

  it('does not mix concurrent transactions', async () => {
    const setup = await connect();
    await setup.query('CREATE TABLE concurrency_probe (v int)');
    await Promise.all(
      Array.from({ length: 6 }, async (_, i) => {
        const client = await connect();
        for (let round = 0; round < 6; round += 1) {
          await client.query('BEGIN');
          await client.query('INSERT INTO concurrency_probe VALUES ($1)', [i]);
          await new Promise((resolve) => setTimeout(resolve, 1));
          await client.query(round % 2 === 0 ? 'COMMIT' : 'ROLLBACK');
        }
        await client.end();
      }),
    );
    const { rows } = await setup.query('SELECT count(*)::int AS n FROM concurrency_probe');
    expect(rows[0].n).toBe(18);
    await setup.end();
  });

  it('gives every concurrent query its own statement and parameters', async () => {
    const clients = await Promise.all(Array.from({ length: 8 }, connect));
    await Promise.all(
      clients.map(async (client, c) => {
        for (let i = 0; i < 25; i += 1) {
          const value = `${c}-${i}`;
          // Distinct statements per client: a crossed Bind fails or returns the wrong column.
          const { rows } = await client.query(`SELECT $1::text AS value, ${c}::int AS client`, [value]);
          expect(rows[0]).toEqual({ value, client: c });
        }
      }),
    );
    await Promise.all(clients.map((client) => client.end()));
  });

  it('runs a query as one request when its messages arrive apart', async () => {
    const other = await connect();
    const raw = tcpConnect(server.port, server.host);
    const received: Buffer[] = [];
    raw.on('data', (chunk) => received.push(chunk));
    const readyForQuery = async (): Promise<void> => {
      for (let i = 0; i < 200; i += 1) {
        const all = Buffer.concat(received);
        if (all.length >= 6 && all[all.length - 6] === 0x5a) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('no ReadyForQuery');
    };
    const message = (type: string, body: Buffer): Buffer => {
      const header = Buffer.alloc(5);
      header.write(type, 0);
      header.writeInt32BE(body.length + 4, 1);
      return Buffer.concat([header, body]);
    };
    const cstring = (text: string): Buffer => Buffer.from(`${text}\0`);

    const params = Buffer.concat([
      cstring('user'),
      cstring('postgres'),
      cstring('database'),
      cstring('postgres'),
      Buffer.from([0]),
    ]);
    const startup = Buffer.alloc(8);
    startup.writeInt32BE(params.length + 8, 0);
    startup.writeInt32BE(196608, 4);
    raw.write(Buffer.concat([startup, params]));
    await readyForQuery();
    received.length = 0;

    const parse = message('P', Buffer.concat([cstring(''), cstring("SELECT 'raw-client' AS who"), Buffer.alloc(2)]));
    const bind = message('B', Buffer.concat([cstring(''), cstring(''), Buffer.alloc(6)]));
    const execute = message('E', Buffer.concat([cstring(''), Buffer.alloc(4)]));
    const sync = message('S', Buffer.alloc(0));

    // Another connection's unnamed statement runs between this connection's Parse and its Bind.
    raw.write(parse);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect((await other.query("SELECT 'other-client'::text AS who")).rows[0].who).toBe('other-client');
    raw.write(bind);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect((await other.query("SELECT 'other-client'::text AS who")).rows[0].who).toBe('other-client');
    raw.write(Buffer.concat([execute, sync]));
    await readyForQuery();

    expect(Buffer.concat(received).includes('raw-client')).toBe(true);
    expect(Buffer.concat(received).includes('other-client')).toBe(false);
    raw.destroy();
    await other.end();
  });

  it('rolls back the transaction of a connection that disappears', async () => {
    const [owner, other] = [await connect(), await connect()];
    await other.query('CREATE TABLE lost_probe (v int)');
    await owner.query('BEGIN');
    await owner.query('INSERT INTO lost_probe VALUES (1)');
    (owner as unknown as { connection: { stream: { destroy(): void } } }).connection.stream.destroy();
    const { rows } = await other.query('SELECT count(*)::int AS n FROM lost_probe');
    expect(rows[0].n).toBe(0);
    await other.end();
  });

  it('keeps serving after a client ends its connection', async () => {
    const first = await connect();
    await first.end();
    const second = await connect();
    expect((await second.query('SELECT 1::int AS one')).rows[0].one).toBe(1);
    await second.end();
  });

  it('cuts a stuck transaction, rolls it back, and frees the waiting connections', async () => {
    const [owner, other] = [await connect(), await connect()];
    await owner.query('CREATE TABLE stuck_probe (v int)');
    await owner.query('BEGIN');
    await owner.query('INSERT INTO stuck_probe VALUES (1)');
    // On a real server this read would return at once; here it waits behind the open transaction.
    const { rows } = await other.query('SELECT count(*)::int AS n FROM stuck_probe');
    expect(rows[0].n).toBe(0);
    expect(stuck.length).toBeGreaterThan(0);
    expect(stuck.at(-1)?.idleMs).toBeGreaterThanOrEqual(1500);
    await expect(owner.query('SELECT 1')).rejects.toThrow();
    await other.end();
  }, 15_000);
});
