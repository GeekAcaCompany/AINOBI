// SPDX-License-Identifier: AGPL-3.0-only
import "../ensure-env.ts";
import { DataSource } from "typeorm";
import { Redis } from "ioredis";

import * as entities from "../models/index.ts";
/**
 * Persistent database
 */
export const dataSource = new DataSource({
  type: (process.env.DB_TYPE || "postgres") as any,
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  // Managed PostgreSQL (OCI) only accepts encrypted connections.
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  entities: Object.values(entities),
  logging: process.env.DB_LOGGING === 'true',
  subscribers: [],
});

/**
 * Cache database
 */
export const redisClient = new Redis({
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT || 6379),
  username: process.env.REDIS_USER,
  password: process.env.REDIS_PASSWORD,
  db: Number(process.env.REDIS_DB || 0),
  // Managed Redis (OCI Cache) only accepts TLS connections.
  tls: process.env.REDIS_TLS === "true" ? { rejectUnauthorized: false } : undefined,
  lazyConnect: true,
  sentinelRetryStrategy: times => Math.min(times * 100, 10000)
});
