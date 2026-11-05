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
    initPromise = dataSource.initialize().then(() => {
      console.log("Database initialized");
    });
  }
  await initPromise;
}
