// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Data layer factory (the host passes connection config and the entity set; this package reads no environment variables).
 *
 * - TypeORM DataSource: synchronize is always false (the migration chain owns the schema)
 * - ioredis: lazyConnect, sharing the same Redis instance and key space as the existing services
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import {
  DataSource,
  EventSubscriber,
  type DataSourceOptions,
  type EntitySubscriberInterface,
  type InsertEvent,
} from "typeorm";
import { Redis } from "ioredis";

/**
 * Insert fallback subscriber: automated defense against two NOT-NULL landmines.
 *
 * 1. uuid primary keys: an "auto-generated" column (@PrimaryGeneratedColumn("uuid")) left unset →
 *    filled with randomUUID(). The PG driver declares uuid generation support, so TypeORM emits `DEFAULT` for such an unset column
 *    in the INSERT — but the migration chain owns the schema (synchronize always false,
 *    no server_default on the column), so `DEFAULT` means NULL → NOT NULL violation. The subscriber
 *    broadcasts before SQL is built (on both the save and insert paths).
 * 2. @CreateDateColumn / @UpdateDateColumn timestamps: those TypeORM decorators carry no
 *    generator (unlike uuid's generationStrategy), so an unset value emits DEFAULT as well →
 *    NOT NULL violation. The subscriber fills unset timestamp columns with new Date().
 *
 * Boundaries:
 * - explicitly assigned columns are kept as-is (idempotent, never overwritten)
 * - `@PrimaryColumn("uuid")` (assigned explicitly by the service layer) is not in the generated set and is never filled
 * - only undefined (unset) is filled; explicit null/empty strings go up as-is and the database reports the error
 */
@EventSubscriber()
export class UuidPkSubscriber implements EntitySubscriberInterface {
  beforeInsert(event: InsertEvent<unknown>): void {
    const entity = event.entity;
    if (entity === null || entity === undefined || typeof entity !== "object") {
      return;
    }
    for (const column of event.metadata.primaryColumns) {
      if (!(column.isGenerated && column.generationStrategy === "uuid")) {
        continue;
      }
      if (column.getEntityValue(entity, false) === undefined) {
        column.setEntityValue(entity, randomUUID());
      }
    }
    for (const column of event.metadata.ownColumns) {
      if (column.isCreateDate || column.isUpdateDate) {
        if (column.getEntityValue(entity, false) === undefined) {
          column.setEntityValue(entity, new Date());
        }
      }
    }
  }
}

/** PostgreSQL connection config */
export interface DatabaseSettings {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  /**
   * libpq-style TLS mode from the host's POSTGRESQL_SSLMODE (production requires `require`).
   * `require`/`prefer` encrypt without certificate verification (libpq semantics, matching the
   * Python twin's `?ssl=require`); `verify-ca`/`verify-full` verify; absent or `disable` = plaintext.
   */
  sslmode?: string;
}

/** libpq sslmode → node-postgres ssl option */
function resolvePgSsl(mode: string | undefined): boolean | { rejectUnauthorized: boolean } | undefined {
  const normalized = (mode ?? "").trim().toLowerCase();
  if (!normalized || normalized === "disable" || normalized === "allow") {
    return undefined;
  }
  return normalized === "verify-ca" || normalized === "verify-full" ? true : { rejectUnauthorized: false };
}

/**
 * PostgreSQL DataSource: UuidPkSubscriber is always mounted; pool defaults are pool 10 /
 * overflow 20 / timeout 15s (overridable through extra).
 */
export function createDataSource(
  settings: DatabaseSettings,
  options: {
    entities: NonNullable<DataSourceOptions["entities"]>;
    extra?: Record<string, unknown>;
  },
): DataSource {
  return new DataSource({
    type: "postgres",
    host: settings.host,
    port: settings.port,
    username: settings.username,
    password: settings.password,
    database: settings.database,
    ssl: resolvePgSsl(settings.sslmode),
    entities: options.entities,
    subscribers: [UuidPkSubscriber],
    synchronize: false,
    poolSize: 10,
    extra: {
      max: 30,
      idleTimeoutMillis: 15000,
      // Pool-acquire timeout: a request waiting for a connection fails fast instead of
      // hanging forever when the pool is exhausted (the Python twin's pool_timeout: 15).
      connectionTimeoutMillis: 15000,
      ...options.extra,
    },
  });
}

/** Redis connection config (empty username/password count as unset) */
export interface RedisSettings {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db: number;
  /** TLS (the host maps its REDIS_SSL); certificate verification relaxed like the sibling services */
  tls?: boolean;
}

/** Lazily connected Redis client: auto-reconnect + offline queue */
export function createRedisClient(settings: RedisSettings): Redis {
  return new Redis({
    host: settings.host,
    port: settings.port,
    username: settings.username || undefined,
    password: settings.password || undefined,
    db: settings.db,
    tls: settings.tls ? { rejectUnauthorized: false } : undefined,
    lazyConnect: true,
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
  });
}
