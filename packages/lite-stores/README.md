# @ainobi/lite-stores

Local stores for running without Docker or a database install. Each one is a server speaking the protocol of the real thing, so clients keep their usual drivers (`pg`, TypeORM, `ioredis`, the AWS S3 SDK) and only the connection settings change.

Runtime: Node.js. `pnpm lite` at the repository root wires the stores to the platform services; see `docs/lite-mode.md`.

```ts
import { startDiskStorage, startMemoryRedis, startPgliteServer } from '@ainobi/lite-stores';

const pg = await startPgliteServer({
  dataDir: './data/pg', // omit for in-memory
  port: 55432,
  initialize: async (db) => {
    await db.exec('CREATE TABLE IF NOT EXISTS note (body text)');
  },
});

const redis = await startMemoryRedis({ port: 56379 });

const storage = await startDiskStorage({ dir: './data/objects', port: 56390 });

// postgres://postgres:any@127.0.0.1:55432/postgres, redis://127.0.0.1:56379, and
// storage.endpoint as the S3 endpoint with path-style addressing and any credentials

await storage.close();
await redis.close();
await pg.close();
```

All servers bind to loopback by default and have no authentication.

## startPgliteServer

[PGlite](https://pglite.dev) is PostgreSQL compiled to WASM: real SQL semantics, extensions (`uuid-ossp` is loaded), and files on disk. It is a single session, so connections are multiplexed over it:

- A request runs whole, from its first message to Sync, so concurrent extended-protocol queries cannot cross.
- A transaction owns the session: between BEGIN and COMMIT only its connection runs, and other connections wait.

What differs from a PostgreSQL server:

- Transactions run one at a time. A long transaction delays every client, and session state (`SET`, `LISTEN`, temporary tables, named prepared statements) is shared between connections, so clients must not rely on it.
- A transaction that waits on another connection, or on a service that needs the database, would wait forever. The watchdog cuts a transaction idle for `stuckTransactionMs` (default 30 s): its connection drops and the work rolls back. `onStuckTransaction` reports it.
- Query cancellation is not supported, and the major version is PGlite's rather than your production server's.

## startMemoryRedis

Implements the Redis commands the platform uses: strings, expiry, hashes, sets, sorted sets, streams including blocking XREAD, MULTI/EXEC, SCAN, and databases 0-15. Commands outside that set answer an error. Lua is not interpreted: EVAL recognizes the platform's compare-and-delete and get-and-delete scripts and rejects any other.

Data is lost when the process stops, and there is no eviction, so anything that must survive a restart does not belong here.

The test suite states Redis behaviour; run it against a real server to check the two still agree:

```sh
LITE_STORES_REAL_REDIS_URL=redis://127.0.0.1:6379/15 pnpm vitest run --project @ainobi/lite-stores memory-redis
```

## startDiskStorage

Object storage on the local disk behind the S3 HTTP API, with path-style addressing (`/<bucket>/<key>`). Objects are plain files at `<dir>/<bucket>/<key>`, so they can be read and backed up with ordinary tools; characters a file system refuses are percent-encoded in the file name. Content types and ETags live in `<dir>/.lite/`. Buckets exist implicitly.

Implemented: PUT, GET with ranges, HEAD, DELETE, copy, ListObjectsV2 without a delimiter, multipart upload, presigned GET and PUT URLs, browser uploads through a presigned POST including its policy conditions, and CORS for browsers.

What differs from S3:

- Signatures are not checked. Expiry and POST policy conditions are, so a stale link fails as it would in production.
- Object ACLs are accepted and ignored: every object is readable by anyone who can reach the port.
- A key cannot be both an object and a prefix of another (`a` and `a/b`), and keys with empty, `.`, or `..` segments are refused, because a file system cannot hold them.
- On a case-insensitive file system, keys differing only in case are the same object.
