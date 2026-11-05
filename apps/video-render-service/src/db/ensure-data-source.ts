// SPDX-License-Identifier: AGPL-3.0-only
import { dataSource } from "./db.ts";

let initPromise: Promise<void> | null = null;

/**
 * Lazily initialize TypeORM; several callers (HTTP courseware, agent chat) share one Promise to avoid concurrent duplicate connects.
 */
export async function ensureDataSource(): Promise<void> {
  if (dataSource.isInitialized) {
    return;
  }
  if (!initPromise) {
    initPromise = dataSource
      .initialize()
      .then(() => {
        console.log("Database initialized");
      })
      .catch((error: unknown) => {
        // Reset so the next call retries instead of forever awaiting a
        // rejected promise (e.g. a transient DB outage at cold start).
        initPromise = null;
        throw error;
      });
  }
  await initPromise;
}
