// SPDX-License-Identifier: AGPL-3.0-only
import "../ensure-env.ts";
import { DataSource } from "typeorm";
import * as entities from "../models/index.ts";

export default new DataSource({
  type: process.env.DB_TYPE as any,
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  entities: Object.values(entities),
  logging: process.env.DB_LOGGING === 'true',
  migrations: ["src/migrations/*.ts"],
  subscribers: [],
});