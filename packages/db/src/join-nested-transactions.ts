// SPDX-License-Identifier: AGPL-3.0-only
/**
 * For a database with a single session (PGlite): work started inside a transaction joins that transaction
 * instead of taking another connection.
 *
 * On PostgreSQL, a query that opens its own session inside a transaction simply uses a second connection. On
 * a single session that connection waits for the transaction to end while the transaction waits for the query,
 * so the request never finishes. With this installed, everything in the transaction's async context runs on
 * its connection; a nested transaction becomes a savepoint (TypeORM's own behaviour on a query runner already
 * in a transaction), and other requests, being in other async contexts, are unaffected.
 *
 * This changes semantics, which is why only a single-session host installs it: nested work reads the outer
 * transaction's uncommitted changes, and what it writes is undone if the outer transaction rolls back. Nested
 * work must also not run in parallel, because savepoints on one connection are a stack.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { DataSource, QueryRunner } from "typeorm";

/** The outer query runner, for callers that would otherwise acquire and later release their own. */
function borrowed(queryRunner: QueryRunner): QueryRunner {
  return new Proxy(queryRunner, {
    get(target, property) {
      if (property === "release") {
        return async () => {};
      }
      const value = Reflect.get(target, property) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** Installs the behaviour on one DataSource; call it once, before the first query. */
export function joinNestedTransactions(dataSource: DataSource): void {
  const current = new AsyncLocalStorage<QueryRunner>();

  const createQueryRunner = dataSource.createQueryRunner.bind(dataSource);
  dataSource.createQueryRunner = (...args: Parameters<DataSource["createQueryRunner"]>) => {
    const outer = current.getStore();
    // A task that outlives its transaction inherits the context too; it gets a connection of its own.
    if (outer && !outer.isReleased && outer.isTransactionActive) {
      return borrowed(outer);
    }
    return createQueryRunner(...args);
  };

  const transaction = dataSource.manager.transaction.bind(dataSource.manager) as (
    isolation: never,
    run: (manager: DataSource["manager"]) => Promise<unknown>,
  ) => Promise<unknown>;
  dataSource.manager.transaction = ((isolationOrRun: unknown, runParam?: unknown) => {
    const isolation = typeof isolationOrRun === "string" ? isolationOrRun : undefined;
    const run = (typeof isolationOrRun === "function" ? isolationOrRun : runParam) as (
      manager: DataSource["manager"],
    ) => Promise<unknown>;
    const inContext = (manager: DataSource["manager"]): Promise<unknown> =>
      current.run(manager.queryRunner as QueryRunner, () => run(manager));
    return isolation === undefined
      ? (transaction as unknown as (r: typeof inContext) => Promise<unknown>)(inContext)
      : transaction(isolation as never, inContext);
  }) as DataSource["manager"]["transaction"];
}
